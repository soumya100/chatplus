import { upload } from "@vercel/blob/client"

export const AI_ATTACHMENT_MAX_FILE_SIZE = 15 * 1024 * 1024
export const AI_ATTACHMENT_MAX_TOTAL_SIZE = 30 * 1024 * 1024
export const AI_ATTACHMENT_MAX_FILES = 5

export type AIAttachmentKind = "image" | "pdf" | "spreadsheet" | "csv" | "document" | "text" | "generic"

export type AIAttachment = {
  id: string
  url: string
  fileName: string
  fileSize: number
  mimeType: string
  kind: AIAttachmentKind
}

const MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  json: "application/json",
}

const SUPPORTED_MIME_TYPES = new Set(Object.values(MIME_BY_EXTENSION))

export function sanitizeAIFilename(value: string): string {
  const basename = value.split(/[\\/]/).pop() || "attachment"
  return basename.normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[<>:"|?*]/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 120) || "attachment"
}

export function classifyAIAttachment(mimeType: string, fileName: string): AIAttachmentKind {
  if (mimeType.startsWith("image/")) return "image"
  if (mimeType === "application/pdf") return "pdf"
  if (mimeType.includes("spreadsheet") || mimeType === "application/vnd.ms-excel") return "spreadsheet"
  if (mimeType === "text/csv" || mimeType === "application/csv") return "csv"
  if (mimeType.includes("wordprocessingml")) return "document"
  if (mimeType === "text/plain" || mimeType === "text/markdown" || mimeType === "application/json") return "text"
  const extension = fileName.split(".").pop()?.toLowerCase() || ""
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(extension)) return "image"
  if (extension === "pdf") return "pdf"
  if (["xls", "xlsx"].includes(extension)) return "spreadsheet"
  if (extension === "csv") return "csv"
  if (extension === "docx") return "document"
  if (["txt", "md", "markdown", "json"].includes(extension)) return "text"
  return "generic"
}

export async function uploadAIAttachment(
  file: File,
  onProgress?: (percentage: number) => void,
): Promise<AIAttachment> {
  if (file.size < 1) throw new Error("This file is empty.")
  if (file.size > AI_ATTACHMENT_MAX_FILE_SIZE) throw new Error("Each attachment must be 15 MiB or smaller.")

  const fileName = sanitizeAIFilename(file.name)
  const extension = fileName.split(".").pop()?.toLowerCase() || ""
  const browserMime = (file.type || "").split(";")[0].trim().toLowerCase()
  const mappedMime = MIME_BY_EXTENSION[extension]
  const mimeType = SUPPORTED_MIME_TYPES.has(browserMime)
    ? browserMime
    : mappedMime || "application/octet-stream"
  const uploadBody = file.type === mimeType ? file : file.slice(0, file.size, mimeType)

  const blob = await upload(fileName, uploadBody, {
    access: "public",
    handleUploadUrl: "/api/ai/attachments/upload",
    multipart: file.size > 5 * 1024 * 1024,
    onUploadProgress: event => onProgress?.(Math.round(event.percentage)),
  })

  return {
    id: crypto.randomUUID(),
    url: blob.url,
    fileName,
    fileSize: file.size,
    mimeType,
    kind: classifyAIAttachment(mimeType, fileName),
  }
}
