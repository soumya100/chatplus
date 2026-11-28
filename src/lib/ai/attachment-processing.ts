import { inflateRawSync } from "node:zlib"
import { extractText } from "pdfnative"
import * as XLSX from "xlsx"
import { db } from "@/lib/db"
import type { AIAttachment } from "./attachments"

const MAX_FILE_SIZE = 15 * 1024 * 1024
const MAX_ZIP_ENTRIES = 500
const MAX_ZIP_ENTRY_SIZE = 12 * 1024 * 1024
const MAX_ZIP_TOTAL_SIZE = 24 * 1024 * 1024
const MAX_EXTRACTED_CHARS = 12_000
const MAX_CSV_BYTES = 5 * 1024 * 1024

export type ProcessedAIAttachment = {
  attachment: AIAttachment
  actualSize: number
  imageUrl?: string
  extractedText?: string
  notice?: string
}

function isOwnedBlobUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === "https:"
      && !url.username
      && !url.password
      && !url.port
      && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.public\.blob\.vercel-storage\.com$/i.test(url.hostname)
      && url.pathname.length > 1
      && !url.search
      && !url.hash
  } catch {
    return false
  }
}

function decodeXml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#([0-9]+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
}

function xmlText(value: string): string {
  return decodeXml(value
    .replace(/<w:tab\b[^>]*\/>/g, "\t")
    .replace(/<w:br\b[^>]*\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function readZipEntries(bytes: Buffer): Map<string, Buffer> {
  let endOffset = -1
  const searchStart = Math.max(0, bytes.length - 65_557)
  for (let offset = bytes.length - 22; offset >= searchStart; offset--) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) {
      endOffset = offset
      break
    }
  }
  if (endOffset < 0) throw new Error("This Office document is not a supported ZIP-based file.")

  const entryCount = bytes.readUInt16LE(endOffset + 10)
  let cursor = bytes.readUInt32LE(endOffset + 16)
  if (entryCount > MAX_ZIP_ENTRIES) throw new Error("This Office document contains too many archive entries.")

  const entries = new Map<string, Buffer>()
  let totalExpanded = 0

  for (let index = 0; index < entryCount; index++) {
    if (cursor + 46 > bytes.length || bytes.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error("This Office document has a malformed ZIP directory.")
    }
    const method = bytes.readUInt16LE(cursor + 10)
    const compressedSize = bytes.readUInt32LE(cursor + 20)
    const expandedSize = bytes.readUInt32LE(cursor + 24)
    const nameLength = bytes.readUInt16LE(cursor + 28)
    const extraLength = bytes.readUInt16LE(cursor + 30)
    const commentLength = bytes.readUInt16LE(cursor + 32)
    const localOffset = bytes.readUInt32LE(cursor + 42)
    const name = bytes.toString("utf8", cursor + 46, cursor + 46 + nameLength)

    if (name.startsWith("/") || name.split("/").includes("..")) {
      throw new Error("This Office document contains an unsafe archive path.")
    }
    if (expandedSize > MAX_ZIP_ENTRY_SIZE || totalExpanded + expandedSize > MAX_ZIP_TOTAL_SIZE) {
      throw new Error("This Office document expands beyond the safe processing limit.")
    }

    if (!name.endsWith("/")) {
      if (localOffset + 30 > bytes.length || bytes.readUInt32LE(localOffset) !== 0x04034b50) {
        throw new Error("This Office document has a malformed ZIP entry.")
      }
      const localNameLength = bytes.readUInt16LE(localOffset + 26)
      const localExtraLength = bytes.readUInt16LE(localOffset + 28)
      const dataOffset = localOffset + 30 + localNameLength + localExtraLength
      const compressed = bytes.subarray(dataOffset, dataOffset + compressedSize)
      if (compressed.length !== compressedSize) throw new Error("This Office document is truncated.")

      let expanded: Buffer
      if (method === 0) expanded = Buffer.from(compressed)
      else if (method === 8) expanded = inflateRawSync(compressed, { maxOutputLength: MAX_ZIP_ENTRY_SIZE })
      else throw new Error("This Office document uses an unsupported compression method.")

      if (expanded.length !== expandedSize) throw new Error("This Office document failed archive integrity validation.")
      totalExpanded += expanded.length
      entries.set(name, expanded)
    }
    cursor += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

function extractDocx(bytes: Buffer): string {
  const entries = readZipEntries(bytes)
  const document = entries.get("word/document.xml")
  if (!document) throw new Error("The DOCX document body could not be found.")
  return xmlText(document.toString("utf8"))
}

function getXmlAttribute(attributes: string, name: string): string | undefined {
  const match = attributes.match(new RegExp("(?:^|\\s)" + name + "=[\"']([^\"']*)[\"']"))
  return match ? decodeXml(match[1]) : undefined
}

function parseXlsx(bytes: Buffer): string {
  const entries = readZipEntries(bytes)
  const workbook = entries.get("xl/workbook.xml")?.toString("utf8")
  const relationships = entries.get("xl/_rels/workbook.xml.rels")?.toString("utf8")
  if (!workbook || !relationships) throw new Error("The XLSX workbook structure is incomplete.")

  const relationTargets = new Map<string, string>()
  for (const match of relationships.matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
    const id = getXmlAttribute(match[1], "Id")
    const target = getXmlAttribute(match[1], "Target")
    if (id && target) relationTargets.set(id, target.replace(/^\/+/, "").startsWith("xl/") ? target.replace(/^\/+/, "") : "xl/" + target.replace(/^\/+/, ""))
  }

  const sharedStrings: string[] = []
  const sharedXml = entries.get("xl/sharedStrings.xml")?.toString("utf8")
  if (sharedXml) {
    for (const match of sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
      const pieces = [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(item => decodeXml(item[1]))
      sharedStrings.push(pieces.join(""))
    }
  }

  const sheetDefinitions = [...workbook.matchAll(/<sheet\b([^>]*?)\/?>/g)].slice(0, 10)
  if (!sheetDefinitions.length) throw new Error("No worksheets were found in this workbook.")

  const sheets = sheetDefinitions.map(match => {
    const name = getXmlAttribute(match[1], "name") || "Sheet"
    const relationId = getXmlAttribute(match[1], "r:id")
    const target = relationId ? relationTargets.get(relationId) : undefined
    const sheetXml = target ? entries.get(target)?.toString("utf8") : undefined
    if (!sheetXml) return { name, rowCount: 0, headers: [], rows: [] }

    const rows: string[][] = []
    let rowCount = 0
    for (const rowMatch of sheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      rowCount++
      if (rowCount > 200_000) throw new Error("This workbook contains more than 200,000 rows in a worksheet.")
      if (rows.length >= 9) continue
      const values: string[] = []
      for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const reference = getXmlAttribute(cellMatch[1], "r") || ""
        const columnLetters = reference.replace(/[0-9]/g, "")
        let columnIndex = 0
        for (const character of columnLetters) columnIndex = columnIndex * 26 + character.charCodeAt(0) - 64
        columnIndex = Math.max(0, columnIndex - 1)
        const type = getXmlAttribute(cellMatch[1], "t")
        const cellBody = cellMatch[2] || ""
        const valueMatch = cellBody.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)
        const inlineMatch = cellBody.match(/<t\b[^>]*>([\s\S]*?)<\/t>/)
        let value = valueMatch ? decodeXml(valueMatch[1]) : inlineMatch ? decodeXml(inlineMatch[1]) : ""
        if (type === "s" && valueMatch) value = sharedStrings[Number(value)] || ""
        if (type === "b") value = value === "1" ? "true" : "false"
        if (columnIndex < 200) values[columnIndex] = value
      }
      rows.push(values.map(value => value || ""))
    }
    return {
      name,
      rowCount,
      headers: rows[0] || [],
      rows: rows.slice(1, 9),
    }
  })

  return "Workbook summary (formula values are cached values; formulas are not recalculated):\n"
    + JSON.stringify({ sheetNames: sheets.map(sheet => sheet.name), sheets }, null, 2)
}

function summarizeLegacyXls(bytes: Buffer): string {
  const signature = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
  if (!bytes.subarray(0, 8).equals(signature)) throw new Error("This file does not contain a valid legacy Excel workbook.")

  const workbook = XLSX.read(bytes, {
    type: "buffer",
    cellDates: true,
    sheetRows: 200_001,
  })
  if (!workbook.SheetNames.length) throw new Error("No worksheets were found in this XLS workbook.")

  const summaries = workbook.SheetNames.slice(0, 10).map(name => {
    const worksheet = workbook.Sheets[name]
    const rows = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: "",
      blankrows: false,
    }) as unknown[][]
    const cellText = (value: unknown) => value == null
      ? ""
      : value instanceof Date
        ? value.toISOString()
        : typeof value === "object"
          ? JSON.stringify(value)
          : String(value)
    const headers = (rows[0] || []).map(cellText)
    const sampleRows = rows.slice(1, 9).map(row => row.map(cellText))
    const rowCount = rows.length > 200_000 ? "200,000+ (capped)" : String(rows.length)
    return [
      "Sheet: " + name,
      "Row count: " + rowCount,
      "Headers: " + JSON.stringify(headers),
      "First 8 data rows: " + JSON.stringify(sampleRows),
    ].join("\n")
  })
  if (workbook.SheetNames.length > 10) summaries.push("Additional worksheets omitted after the first 10.")
  return "Legacy XLS workbook summary:\n" + summaries.join("\n\n")
}

function parseCsv(text: string): { rowCount: number; headers: string[]; rows: string[][] } {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let quoted = false
  for (let index = 0; index < text.length; index++) {
    const character = text[index]
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"'
        index++
      } else if (character === '"') quoted = false
      else field += character
    } else if (character === '"' && field.length === 0) quoted = true
    else if (character === ",") {
      row.push(field)
      field = ""
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index++
      row.push(field)
      field = ""
      if (row.some(value => value.length > 0)) rows.push(row)
      row = []
      if (rows.length > 100_000) throw new Error("This CSV contains more than 100,000 rows.")
    } else field += character
  }
  row.push(field)
  if (row.some(value => value.length > 0)) rows.push(row)
  if (quoted) throw new Error("This CSV contains an unclosed quoted field.")
  return { rowCount: rows.length, headers: rows[0] || [], rows: rows.slice(1, 9) }
}

function truncateText(value: string): string {
  const clean = value.replace(/\u0000/g, "").trim()
  if (clean.length <= MAX_EXTRACTED_CHARS) return clean
  return clean.slice(0, MAX_EXTRACTED_CHARS) + "\n\n[Attachment text truncated at 12,000 characters to fit the model context.]"
}

function decodeText(bytes: Buffer): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes)
}

export async function processAIAttachment(
  attachment: AIAttachment,
  userId: string,
  signal: AbortSignal,
): Promise<ProcessedAIAttachment> {
  if (!isOwnedBlobUrl(attachment.url)) throw new Error("An attachment URL is invalid.")
  // The client URL is used only as an ownership lookup key. Fetch the canonical
  // URL recorded by the trusted upload-completion callback, never the request value.
  const ownershipRecord = await db.get("ai:attachment-owner:" + attachment.url)
  let ownership: { userId?: string; url?: string } | null = null
  try {
    ownership = (typeof ownershipRecord === "string"
      ? JSON.parse(ownershipRecord)
      : ownershipRecord) as { userId?: string; url?: string } | null
  } catch {
    ownership = null
  }
  if (
    !ownership
    || ownership.userId !== userId
    || typeof ownership.url !== "string"
    || !isOwnedBlobUrl(ownership.url)
  ) {
    throw new Error("This attachment is not owned by the signed-in account. Please upload it again.")
  }
  const blobUrl = ownership.url

  const head = await fetch(blobUrl, { method: "HEAD", redirect: "error", signal, cache: "no-store" })
  if (!head.ok) throw new Error("Unable to read " + attachment.fileName + " from file storage.")
  const actualMime = (head.headers.get("content-type") || "application/octet-stream").split(";")[0].trim().toLowerCase()
  const actualSize = Number(head.headers.get("content-length") || attachment.fileSize)
  if (!Number.isFinite(actualSize) || actualSize < 1 || actualSize > MAX_FILE_SIZE) {
    throw new Error(attachment.fileName + " exceeds the 15 MiB processing limit.")
  }

  if (attachment.kind === "image") {
    if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(actualMime)) {
      throw new Error(attachment.fileName + " is not a supported raster image.")
    }
    const imageResponse = await fetch(blobUrl, { redirect: "error", signal, cache: "no-store" })
    if (!imageResponse.ok) throw new Error("Unable to validate " + attachment.fileName + ".")
    const imageBytes = Buffer.from(await imageResponse.arrayBuffer())
    const isPng = actualMime === "image/png" && imageBytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    const isJpeg = actualMime === "image/jpeg" && imageBytes[0] === 0xff && imageBytes[1] === 0xd8 && imageBytes[2] === 0xff
    const isGif = actualMime === "image/gif" && ["GIF87a", "GIF89a"].includes(imageBytes.subarray(0, 6).toString("ascii"))
    const isWebp = actualMime === "image/webp" && imageBytes.subarray(0, 4).toString("ascii") === "RIFF" && imageBytes.subarray(8, 12).toString("ascii") === "WEBP"
    if (!isPng && !isJpeg && !isGif && !isWebp) throw new Error(attachment.fileName + " does not match its declared image type.")
    return { attachment, actualSize, imageUrl: blobUrl }
  }

  if (attachment.kind === "generic") {
    return {
      attachment,
      actualSize,
      notice: "The file is attached, but ChatPlus cannot extract its contents. It is available as a downloadable file only.",
    }
  }

  const response = await fetch(blobUrl, { redirect: "error", signal, cache: "no-store" })
  if (!response.ok) throw new Error("Unable to download " + attachment.fileName + " for processing.")
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length > MAX_FILE_SIZE) throw new Error(attachment.fileName + " exceeds the 15 MiB processing limit.")

  let extracted = ""
  const extension = attachment.fileName.split(".").pop()?.toLowerCase() || ""

  if (attachment.kind === "pdf") {
    if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error(attachment.fileName + " is not a valid PDF.")
    const pages = extractText(bytes, { maxTextLength: 100_000 })
    extracted = pages.map(page => page.text).join("\n\n")
    if (!extracted.trim()) {
      return { attachment, actualSize, notice: "This PDF has no extractable text. It may be scanned or image-only; OCR is not enabled." }
    }
  } else if (attachment.kind === "document") {
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error(attachment.fileName + " is not a valid DOCX file.")
    extracted = extractDocx(bytes)
  } else if (attachment.kind === "spreadsheet") {
    if (extension === "xls") {
      try {
        extracted = summarizeLegacyXls(bytes)
      } catch (error) {
        return { attachment, actualSize, notice: error instanceof Error ? error.message : "Unable to read this legacy XLS workbook. Save it as XLSX and attach it again." }
      }
    } else {
      if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error(attachment.fileName + " is not a valid XLSX workbook.")
      extracted = parseXlsx(bytes)
    }
  } else if (attachment.kind === "csv") {
    if (bytes.length > MAX_CSV_BYTES) throw new Error("CSV files must be 5 MiB or smaller for tabular analysis.")
    const parsed = parseCsv(decodeText(bytes))
    extracted = "CSV summary (first 8 data rows):\n" + JSON.stringify(parsed, null, 2)
  } else if (attachment.kind === "text") {
    extracted = decodeText(bytes)
    if (extension === "json" || actualMime === "application/json") {
      try {
        extracted = JSON.stringify(JSON.parse(extracted), null, 2)
      } catch {
        throw new Error(attachment.fileName + " contains invalid JSON.")
      }
    }
  }

  if (!extracted.trim()) {
    return { attachment, actualSize, notice: "No readable text was found in this file." }
  }
  return { attachment, actualSize, extractedText: truncateText(extracted) }
}
