import { getServerSession } from "next-auth"
import { z } from "zod"
import { authOptions } from "@/lib/auth"
import { rateLimit } from "@/lib/ratelimit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_IMAGE_BYTES = 1.25 * 1024 * 1024
const imageSchema = z.string().max(Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 64).refine(value => {
  const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(value)
  if (!match) return false
  const encoded = match[1]
  if (encoded.length % 4 !== 0) return false
  const decoded = Buffer.from(encoded, "base64")
  return decoded.byteLength > 0 &&
    decoded.byteLength <= MAX_IMAGE_BYTES &&
    decoded.toString("base64") === encoded &&
    decoded[0] === 0xff && decoded[1] === 0xd8 && decoded[2] === 0xff
}, "Generated image must be a valid RGB JPEG smaller than 1.25 MiB")

const sourceSchema = z.object({
  title: z.string().max(240),
  url: z.string().url().max(2048),
  snippet: z.string().max(900),
  publishedDate: z.string().max(40).optional(),
}).strict().refine(source => {
  try {
    const url = new URL(source.url)
    return url.protocol === "https:" || url.protocol === "http:"
  } catch {
    return false
  }
}, "Source URL must use HTTP or HTTPS")

const requestSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().max(16000),
    sources: z.array(sourceSchema).max(5).optional(),
    imageData: imageSchema.optional(),
  }).strict()).min(1).max(80),
}).strict().refine(value => value.messages.some(message => message.role === "assistant" && (message.content.trim() || message.sources?.length || message.imageData)), {
  message: "Add at least one assistant response before exporting",
}).refine(value => {
  const imageCount = value.messages.filter(message => message.imageData).length
  const total = value.messages.reduce((sum, message) =>
    sum + message.content.length + (message.imageData?.length || 0) +
    (message.sources || []).reduce((sourceSum, source) => sourceSum + source.title.length + source.url.length + source.snippet.length, 0), 0)
  return imageCount <= 2 && total <= 3_700_000
}, {
  message: "This conversation is too large to export. Export a shorter conversation with no more than two images.",
})

type ExportMessage = z.infer<typeof requestSchema>["messages"][number]
type PageItem = { kind: "text"; value: string } | { kind: "image"; index: number; width: number; height: number }
type PdfPage = { items: PageItem[]; images: number[] }

function toPdfText(value: string): string {
  const replacements: Record<string, string> = {
    "’": "'", "‘": "'", "“": '"', "”": '"', "–": "-", "—": "--",
    "…": "...", "•": "*", "→": "->", "←": "<-", "✓": "[x]", "×": "x",
    "©": "(c)", "®": "(R)", "™": "(TM)", "₹": "INR ",
  }
  return value.normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’‘“”–—…•→←✓×©®™₹]/g, character => replacements[character] || "")
    .replace(/[^\x20-\x7E]/g, "?")
}

function markdownLines(value: string): string[] {
  const lines: string[] = []
  let inCode = false
  for (const rawLine of value.replace(/\r/g, "").split("\n")) {
    const trimmed = rawLine.trim()
    if (/^`{3,}/.test(trimmed)) {
      inCode = !inCode
      if (!inCode) lines.push("")
      continue
    }
    if (!trimmed) {
      lines.push("")
      continue
    }
    let line = rawLine
    if (!inCode) {
      line = line.replace(/^\s{0,3}#{1,6}\s+/, "")
        .replace(/^\s*[-*+]\s+/, "• ")
        .replace(/^\s*\d+[.)]\s+/, "• ")
        .replace(/\*\*(.*?)\*\*/g, "$1")
        .replace(/\*(.*?)\*/g, "$1")
        .replace(/__(.*?)__/g, "$1")
        .replace(/_(.*?)_/g, "$1")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1 ($2)")
    } else {
      line = "    " + line
    }
    lines.push(line)
  }
  return lines
}

function wrapLine(value: string, maxChars: number): string[] {
  const words = value.split(/\s+/)
  const output: string[] = []
  let current = ""
  for (const word of words) {
    if (!word) continue
    if (word.length > maxChars) {
      if (current) output.push(current)
      current = ""
      for (let offset = 0; offset < word.length; offset += maxChars) {
        const part = word.slice(offset, offset + maxChars)
        if (part.length === maxChars) output.push(part)
        else current = part
      }
      continue
    }
    if (!current) current = word
    else if (current.length + word.length + 1 <= maxChars) current += " " + word
    else {
      output.push(current)
      current = word
    }
  }
  if (current) output.push(current)
  return output.length ? output : [""]
}

function pdfLiteral(value: string): string {
  return "(" + toPdfText(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)") + ")"
}

function readJpegDimensions(data: Buffer): { width: number; height: number; components: number } | null {
  let offset = 2
  while (offset + 4 < data.length) {
    if (data[offset] !== 0xff) return null
    const marker = data[offset + 1]
    offset += 2
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue
    if (offset + 2 > data.length) return null
    const segmentLength = data.readUInt16BE(offset)
    if (segmentLength < 2 || offset + segmentLength > data.length) return null
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (segmentLength < 7) return null
      return { height: data.readUInt16BE(offset + 3), width: data.readUInt16BE(offset + 5), components: data[offset + 7] }
    }
    offset += segmentLength
  }
  return null
}

function createPdf(messages: ExportMessage[]): Buffer {
  const pageWidth = 595
  const pageHeight = 842
  const margin = 48
  const lineHeight = 14
  const maxChars = 92
  const pages: PdfPage[] = [{ items: [], images: [] }]
  let pageIndex = 0
  let y = pageHeight - margin
  const images: Buffer[] = []

  const nextPage = () => {
    pages.push({ items: [], images: [] })
    pageIndex += 1
    y = pageHeight - margin
  }
  const addText = (value: string) => {
    if (y < margin + lineHeight) nextPage()
    pages[pageIndex].items.push({ kind: "text", value })
    y -= lineHeight
  }
  const addImage = (dataUrl: string) => {
    const base64 = dataUrl.slice("data:image/jpeg;base64,".length)
    const image = Buffer.from(base64, "base64")
    const dimensions = readJpegDimensions(image)
    if (!dimensions || dimensions.components !== 3 || dimensions.width < 1 || dimensions.height < 1 || dimensions.width > 12000 || dimensions.height > 12000) {
      addText("[Image could not be embedded: unsupported JPEG dimensions]")
      return
    }
    const maxWidth = pageWidth - margin * 2
    const maxHeight = 300
    const scale = Math.min(maxWidth / dimensions.width, maxHeight / dimensions.height, 1)
    const width = dimensions.width * scale
    const height = dimensions.height * scale
    if (y - height < margin) nextPage()
    const imageIndex = images.length
    images.push(image)
    pages[pageIndex].images.push(imageIndex)
    pages[pageIndex].items.push({ kind: "image", index: imageIndex, width, height })
    y -= height + 16
  }

  addText("ChatPlus AI - Conversation export")
  addText("Generated " + new Date().toISOString())
  addText("")
  messages.forEach((message, index) => {
    addText((message.role === "user" ? "You" : "ChatPlus AI") + " - Message " + (index + 1))
    for (const line of markdownLines(message.content)) {
      for (const wrapped of wrapLine(toPdfText(line), maxChars)) addText(wrapped)
    }
    if (message.imageData) {
      addText("Generated image:")
      addImage(message.imageData)
    }
    if (message.sources?.length) {
      addText("Sources:")
      message.sources.forEach((source, sourceIndex) => {
        addText("[" + (sourceIndex + 1) + "] " + source.title)
        addText(source.url)
        if (source.publishedDate) addText("Published: " + source.publishedDate)
        for (const wrapped of wrapLine(source.snippet, maxChars)) addText(wrapped)
      })
    }
    addText("")
  })

  const objects: Buffer[] = []
  objects.push(Buffer.from("<< /Type /Catalog /Pages 2 0 R >>", "ascii"))
  const pageObjectIds = pages.map((_, index) => 4 + index * 2)
  objects.push(Buffer.from("<< /Type /Pages /Kids [" + pageObjectIds.map(id => id + " 0 R").join(" ") + "] /Count " + pages.length + " >>", "ascii"))
  objects.push(Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>", "ascii"))

  pages.forEach((page, index) => {
    const pageObjectId = pageObjectIds[index]
    const contentObjectId = pageObjectId + 1
    const xObjects = page.images.map(imageIndex => "/Im" + imageIndex + " " + (4 + pages.length * 2 + imageIndex) + " 0 R").join(" ")
    const resources = "<< /Font << /F1 3 0 R >>" + (xObjects ? " /XObject << " + xObjects + " >>" : "") + " >>"
    objects.push(Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + pageWidth + " " + pageHeight + "] /Resources " + resources + " /Contents " + contentObjectId + " 0 R >>", "ascii"))

    let cursorY = pageHeight - margin
    const commands: string[] = []
    for (const item of page.items) {
      if (item.kind === "text") {
        commands.push("BT /F1 10 Tf 1 0 0 1 " + margin + " " + cursorY + " Tm " + pdfLiteral(item.value) + " Tj ET")
        cursorY -= lineHeight
      } else {
        const imageY = cursorY - item.height
        commands.push("q " + item.width.toFixed(2) + " 0 0 " + item.height.toFixed(2) + " " + margin + " " + imageY.toFixed(2) + " cm /Im" + item.index + " Do Q")
        cursorY = imageY - 16
      }
    }
    const content = Buffer.from(commands.join("\n"), "ascii")
    objects.push(Buffer.concat([
      Buffer.from("<< /Length " + content.length + " >>\nstream\n", "ascii"),
      content,
      Buffer.from("\nendstream", "ascii"),
    ]))
  })

  images.forEach((image, index) => {
    const dimensions = readJpegDimensions(image)!
    const header = Buffer.from("<< /Type /XObject /Subtype /Image /Width " + dimensions.width + " /Height " + dimensions.height + " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " + image.length + " >>\nstream\n", "ascii")
    objects.push(Buffer.concat([header, image, Buffer.from("\nendstream", "ascii")]))
  })

  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n", "ascii")]
  const offsets = [0]
  let byteLength = chunks[0].length
  objects.forEach((object, index) => {
    offsets.push(byteLength)
    const prefix = Buffer.from((index + 1) + " 0 obj\n", "ascii")
    const suffix = Buffer.from("\nendobj\n", "ascii")
    chunks.push(prefix, object, suffix)
    byteLength += prefix.length + object.length + suffix.length
  })
  const xrefOffset = byteLength
  let xref = "xref\n0 " + (objects.length + 1) + "\n0000000000 65535 f \n"
  offsets.slice(1).forEach(offset => { xref += String(offset).padStart(10, "0") + " 00000 n \n" })
  xref += "trailer\n<< /Size " + (objects.length + 1) + " /Root 1 0 R >>\nstartxref\n" + xrefOffset + "\n%%EOF"
  chunks.push(Buffer.from(xref, "ascii"))
  return Buffer.concat(chunks)
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return Response.json({ message: "Unauthorized" }, { status: 401 })
  if (process.env.AI_PDF_EXPORT_ENABLED === "false") {
    return Response.json({ message: "PDF export is temporarily unavailable" }, { status: 503 })
  }

  let body: z.infer<typeof requestSchema>
  try {
    body = requestSchema.parse(await request.json())
  } catch (error) {
    const message = error instanceof z.ZodError ? error.issues[0]?.message : undefined
    return Response.json({ message: message || "Invalid PDF export request" }, { status: 400 })
  }

  if (Buffer.byteLength(JSON.stringify(body), "utf8") > 4_200_000) {
    return Response.json({ message: "This PDF export is too large. Try exporting fewer messages or images." }, { status: 413 })
  }

  const quota = await rateLimit(session.user.id, "ai-pdf-export", {
    limit: Math.max(1, Math.min(20, Number(process.env.AI_PDF_RATE_LIMIT) || 5)),
    windowSeconds: 60 * 60,
  })
  if (!quota.success) {
    return Response.json({ message: "You've reached the PDF export limit. Please try again in an hour." }, {
      status: 429,
      headers: { "Retry-After": "3600" },
    })
  }

  try {
    const pdf = createPdf(body.messages)
    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="chatplus-conversation.pdf"',
        "Content-Length": String(pdf.byteLength),
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (error) {
    console.error("[ai-pdf] PDF generation failed", error)
    return Response.json({ message: "Unable to generate the PDF. Please try again." }, { status: 500 })
  }
}
