import { getServerSession } from "next-auth"
import {
  buildDocumentPDFBytes,
  loadFontData,
  registerFonts,
} from "pdfnative"
import { z } from "zod"
import { authOptions } from "@/lib/auth"
import { rateLimit } from "@/lib/ratelimit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_IMAGE_BYTES = 1.25 * 1024 * 1024
const MAX_PDF_BYTES = 12 * 1024 * 1024

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
}).strict().refine(value => value.messages.some(message =>
  message.role === "assistant" && (message.content.trim() || message.sources?.length || message.imageData)
), {
  message: "Add at least one assistant response before exporting",
}).refine(value => {
  const imageCount = value.messages.filter(message => message.imageData).length
  const total = value.messages.reduce((sum, message) =>
    sum + message.content.length + (message.imageData?.length || 0) +
    (message.sources || []).reduce((sourceSum, source) =>
      sourceSum + source.title.length + source.url.length + source.snippet.length, 0), 0)
  return imageCount <= 2 && total <= 3_700_000
}, {
  message: "This conversation is too large to export. Export a shorter conversation with no more than two images.",
})

type ExportMessage = z.infer<typeof requestSchema>["messages"][number]
type PdfBlock =
  | { type: "heading"; text: string; level: 1 | 2 | 3 }
  | { type: "paragraph"; text: string; direction?: "auto" }
  | { type: "image"; data: Uint8Array; width: number; align: "center"; alt: string }
  | { type: "spacer"; height: number }

const FONT_LOADERS = {
  ar: () => import("pdfnative/fonts/noto-arabic-data.js"),
  he: () => import("pdfnative/fonts/noto-hebrew-data.js"),
  hi: () => import("pdfnative/fonts/noto-devanagari-data.js"),
  bn: () => import("pdfnative/fonts/noto-bengali-data.js"),
  gu: () => import("pdfnative/fonts/noto-gujarati-data.js"),
  pa: () => import("pdfnative/fonts/noto-gurmukhi-data.js"),
  ta: () => import("pdfnative/fonts/noto-tamil-data.js"),
  te: () => import("pdfnative/fonts/noto-telugu-data.js"),
  kn: () => import("pdfnative/fonts/noto-kannada-data.js"),
  ml: () => import("pdfnative/fonts/noto-malayalam-data.js"),
  th: () => import("pdfnative/fonts/noto-thai-data.js"),
  lo: () => import("pdfnative/fonts/noto-lao-data.js"),
  km: () => import("pdfnative/fonts/noto-khmer-data.js"),
  my: () => import("pdfnative/fonts/noto-myanmar-data.js"),
  bo: () => import("pdfnative/fonts/noto-tibetan-data.js"),
  ja: () => import("pdfnative/fonts/noto-jp-data.js"),
  zh: () => import("pdfnative/fonts/noto-sc-data.js"),
  ko: () => import("pdfnative/fonts/noto-kr-data.js"),
  el: () => import("pdfnative/fonts/noto-greek-data.js"),
  ru: () => import("pdfnative/fonts/noto-cyrillic-data.js"),
  latin: () => import("pdfnative/fonts/noto-sans-data.js"),
  emoji: () => import("pdfnative/fonts/noto-emoji-data.js"),
}

type FontLanguage = keyof typeof FONT_LOADERS

function getRequiredFontLanguages(texts: string[]): FontLanguage[] {
  const allText = texts.join("\n")
  const required = new Set<FontLanguage>()
  const has = (pattern: RegExp) => pattern.test(allText)

  if (has(/[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/u)) required.add("ar")
  if (has(/[\u0590-\u05ff\uFB1D-\uFB4F]/u)) required.add("he")
  if (has(/[\u0900-\u097f]/u)) required.add("hi")
  if (has(/[\u0980-\u09ff]/u)) required.add("bn")
  if (has(/[\u0a80-\u0aff]/u)) required.add("gu")
  if (has(/[\u0a00-\u0a7f]/u)) required.add("pa")
  if (has(/[\u0b80-\u0bff]/u)) required.add("ta")
  if (has(/[\u0c00-\u0c7f]/u)) required.add("te")
  if (has(/[\u0c80-\u0cff]/u)) required.add("kn")
  if (has(/[\u0d00-\u0d7f]/u)) required.add("ml")
  if (has(/[\u0e00-\u0e7f]/u)) required.add("th")
  if (has(/[\u0e80-\u0eff]/u)) required.add("lo")
  if (has(/[\u1780-\u17ff]/u)) required.add("km")
  if (has(/[\u1000-\u109f]/u)) required.add("my")
  if (has(/[\u0f00-\u0fff]/u)) required.add("bo")
  if (has(/[\u3040-\u30ff\u31f0-\u31ff\u4e00-\u9fff]/u)) required.add("ja")
  if (has(/[\u3400-\u4dbf\u4e00-\u9fff]/u)) required.add("zh")
  if (has(/[\uac00-\ud7af\u1100-\u11ff]/u)) required.add("ko")
  if (has(/[\u0370-\u03ff\u1f00-\u1fff]/u)) required.add("el")
  if (has(/[\u0400-\u052f]/u)) required.add("ru")
  if (has(/[\u0100-\u024f\u1e00-\u1eff\u0300-\u036f]/u)) required.add("latin")
  if (has(/[\u{1f000}-\u{1faff}]/u)) required.add("emoji")

  return [...required]
}

async function loadDocumentFonts(texts: string[]) {
  const languages = getRequiredFontLanguages(texts)
  registerFonts(FONT_LOADERS)
  const loaded = await Promise.all(languages.map(async lang => ({
    lang,
    fontData: await loadFontData(lang),
  })))
  return loaded.flatMap((entry, index) => entry.fontData ? [{
    fontData: entry.fontData,
    fontRef: `/F${index + 3}`,
    lang: entry.lang,
  }] : [])
}

function markdownBlocks(value: string): PdfBlock[] {
  const blocks: PdfBlock[] = []
  let inCode = false
  let codeLines: string[] = []

  const flushCode = () => {
    if (!codeLines.length) return
    blocks.push({ type: "paragraph", text: codeLines.join("\n") })
    codeLines = []
  }

  for (const rawLine of value.replace(/\r/g, "").split("\n")) {
    const trimmed = rawLine.trim()
    if (/^`{3,}/.test(trimmed)) {
      if (inCode) flushCode()
      inCode = !inCode
      continue
    }
    if (inCode) {
      codeLines.push(rawLine)
      continue
    }
    if (!trimmed) {
      blocks.push({ type: "spacer", height: 5 })
      continue
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed)
    if (heading) {
      blocks.push({
        type: "heading",
        text: heading[2],
        level: heading[1].length as 1 | 2 | 3,
      })
      continue
    }

    let line = rawLine
      .replace(/^\s*[-*+]\s+/, "• ")
      .replace(/^\s*\d+[.)]\s+/, "• ")
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/\*(.*?)\*/g, "$1")
      .replace(/__(.*?)__/g, "$1")
      .replace(/_(.*?)_/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1 ($2)")
    blocks.push({ type: "paragraph", text: line, direction: "auto" })
  }
  if (inCode) flushCode()
  return blocks
}

function buildPdf(messages: ExportMessage[], fontEntries: Awaited<ReturnType<typeof loadDocumentFonts>>): Uint8Array {
  const blocks: PdfBlock[] = [
    { type: "heading", text: "ChatPlus AI — Conversation export", level: 1 },
    { type: "paragraph", text: `Generated ${new Date().toISOString()}` },
    { type: "spacer", height: 12 },
  ]

  messages.forEach((message, index) => {
    blocks.push({
      type: "heading",
      text: `${message.role === "user" ? "You" : "ChatPlus AI"} — Message ${index + 1}`,
      level: 2,
    })
    blocks.push(...markdownBlocks(message.content))

    if (message.imageData) {
      const imageBytes = Buffer.from(message.imageData.slice("data:image/jpeg;base64,".length), "base64")
      blocks.push({ type: "paragraph", text: "Generated image:" })
      blocks.push({
        type: "image",
        data: new Uint8Array(imageBytes),
        width: 440,
        align: "center",
        alt: "Image generated in this ChatPlus conversation",
      })
    }

    if (message.sources?.length) {
      blocks.push({ type: "heading", text: "Sources", level: 3 })
      message.sources.forEach((source, sourceIndex) => {
        blocks.push({ type: "paragraph", text: `[${sourceIndex + 1}] ${source.title}` })
        blocks.push({ type: "paragraph", text: source.url })
        if (source.publishedDate) blocks.push({ type: "paragraph", text: `Published: ${source.publishedDate}` })
        blocks.push({ type: "paragraph", text: source.snippet })
      })
    }
    blocks.push({ type: "spacer", height: 10 })
  })

  return buildDocumentPDFBytes({
    title: "ChatPlus AI conversation",
    blocks,
    fontEntries,
  }, {
    direction: "auto",
    pageWidth: 595.28,
    pageHeight: 841.89,
    margins: { t: 48, r: 48, b: 48, l: 48 },
  })
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
    const texts = body.messages.flatMap(message => [
      message.content,
      ...(message.sources || []).flatMap(source => [source.title, source.url, source.snippet]),
    ])
    const fontEntries = await loadDocumentFonts(texts)
    const pdf = buildPdf(body.messages, fontEntries)
    if (pdf.byteLength > MAX_PDF_BYTES) {
      return Response.json({ message: "The generated PDF is too large. Try exporting a shorter conversation." }, { status: 413 })
    }
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
