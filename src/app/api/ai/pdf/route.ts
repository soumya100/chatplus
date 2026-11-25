import { getServerSession } from "next-auth"
import { z } from "zod"
import { authOptions } from "@/lib/auth"
import { rateLimit } from "@/lib/ratelimit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

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
    imageData: z.string().max(0).optional(),
  }).strict()).min(1).max(80),
}).strict().refine(value => value.messages.some(message => message.role === "assistant" && (message.content.trim() || message.sources?.length)), {
  message: "Add at least one assistant response before exporting",
}).refine(value => value.messages.reduce((total, message) => total + message.content.length + (message.sources || []).reduce((sum, source) => sum + source.title.length + source.url.length + source.snippet.length, 0), 0) <= 48000, {
  message: "This conversation is too long to export in one PDF",
})

type ExportMessage = z.infer<typeof requestSchema>["messages"][number]

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
    if (/^\x60{3,}/.test(trimmed)) {
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

function createPdf(messages: ExportMessage[]): Buffer {
  const pageWidth = 595
  const pageHeight = 842
  const margin = 48
  const lineHeight = 14
  const maxChars = 92
  const pageLines: string[][] = [[]]
  let currentPage = 0
  let y = pageHeight - margin

  const addLine = (value: string) => {
    if (y < margin + lineHeight) {
      pageLines.push([])
      currentPage += 1
      y = pageHeight - margin
    }
    pageLines[currentPage].push(value)
    y -= lineHeight
  }

  addLine("ChatPlus AI - Conversation export")
  addLine("Generated " + new Date().toISOString())
  addLine("")
  messages.forEach((message, index) => {
    addLine((message.role === "user" ? "You" : "ChatPlus AI") + " · Message " + (index + 1))
    for (const line of markdownLines(message.content)) {
      for (const wrapped of wrapLine(toPdfText(line), maxChars)) addLine(wrapped)
    }
    if (message.imageData) addLine("[Image attachment omitted from this text export]")
    if (message.sources?.length) {
      addLine("Sources:")
      message.sources.forEach((source, sourceIndex) => {
        addLine("[" + (sourceIndex + 1) + "] " + source.title)
        addLine(source.url)
        if (source.publishedDate) addLine("Published: " + source.publishedDate)
        for (const wrapped of wrapLine(source.snippet, maxChars)) addLine(wrapped)
      })
    }
    addLine("")
  })

  const objects: string[] = []
  objects.push("<< /Type /Catalog /Pages 2 0 R >>")
  objects.push("<< /Type /Pages /Kids [" + pageLines.map((_, index) => (4 + index * 2) + " 0 R").join(" ") + "] /Count " + pageLines.length + " >>")
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")

  pageLines.forEach((lines, index) => {
    const pageObject = 4 + index * 2
    const contentObject = pageObject + 1
    let cursorY = pageHeight - margin
    const commands = lines.map(line => {
      const command = "BT /F1 10 Tf 1 0 0 1 " + margin + " " + cursorY + " Tm " + pdfLiteral(line) + " Tj ET"
      cursorY -= lineHeight
      return command
    }).join("\n")
    objects.push("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + pageWidth + " " + pageHeight + "] /Resources << /Font << /F1 3 0 R >> >> /Contents " + contentObject + " 0 R >>")
    objects.push("<< /Length " + Buffer.byteLength(commands, "ascii") + " >>\nstream\n" + commands + "\nendstream")
  })

  let pdf = "%PDF-1.4\n"
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, "ascii"))
    pdf += (index + 1) + " 0 obj\n" + object + "\nendobj\n"
  })
  const xrefOffset = Buffer.byteLength(pdf, "ascii")
  pdf += "xref\n0 " + (objects.length + 1) + "\n0000000000 65535 f \n"
  offsets.slice(1).forEach(offset => {
    pdf += String(offset).padStart(10, "0") + " 00000 n \n"
  })
  pdf += "trailer\n<< /Size " + (objects.length + 1) + " /Root 1 0 R >>\nstartxref\n" + xrefOffset + "\n%%EOF"
  return Buffer.from(pdf, "ascii")
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
