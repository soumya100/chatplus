import { getServerSession } from "next-auth"
import { z } from "zod"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const attachmentSchema = z.object({
  id: z.string().min(1).max(80),
  url: z.string().url().max(2048),
  fileName: z.string().min(1).max(120),
  fileSize: z.number().int().min(1).max(15 * 1024 * 1024),
  mimeType: z.string().min(1).max(120),
  kind: z.enum(["image", "pdf", "spreadsheet", "csv", "document", "text", "generic"]),
}).strict()

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(12_000),
  createdAt: z.string().max(40).optional(),
  attachments: z.array(attachmentSchema).max(5).optional(),
  sources: z.array(z.object({
    title: z.string().max(240),
    url: z.string().url().max(2048),
    snippet: z.string().max(900),
    publishedDate: z.string().max(40).optional(),
  }).strict()).max(5).optional(),
  imageData: z.string().url().max(2048).optional(),
  imagePrompt: z.string().max(4000).optional(),
}).strict().refine(message => message.content.trim().length > 0 || Boolean(message.attachments?.length) || Boolean(message.imageData), {
  message: "A message must contain text, an attachment, or a generated image",
})

const requestSchema = z.object({
  messages: z.array(messageSchema).min(1).max(60),
}).strict()

function conversationKey(userId: string): string {
  return "ai:conversation:" + userId + ":default"
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return Response.json({ message: "Unauthorized" }, { status: 401 })

  try {
    const stored = await db.get(conversationKey(session.user.id))
    if (!stored) return Response.json({ messages: [] }, { headers: { "Cache-Control": "private, no-store" } })
    const messages = (typeof stored === "string" ? JSON.parse(stored) : stored) as unknown
    const parsed = z.array(messageSchema).max(60).safeParse(messages)
    return Response.json({ messages: parsed.success ? parsed.data : [] }, {
      headers: { "Cache-Control": "private, no-store" },
    })
  } catch (error) {
    console.error("[ai-conversation] Unable to load conversation", error)
    return Response.json({ message: "Unable to load your AI conversation." }, { status: 503 })
  }
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return Response.json({ message: "Unauthorized" }, { status: 401 })

  let body: z.infer<typeof requestSchema>
  try {
    body = requestSchema.parse(await request.json())
  } catch {
    return Response.json({ message: "Invalid conversation payload." }, { status: 400 })
  }

  const serialized = JSON.stringify(body.messages)
  if (Buffer.byteLength(serialized, "utf8") > 200 * 1024) {
    return Response.json({ message: "This conversation is too large to save. Start a new chat to continue." }, { status: 413 })
  }

  try {
    await db.set(conversationKey(session.user.id), serialized, { ex: 60 * 60 * 24 * 30 })
    return Response.json({ saved: true }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    console.error("[ai-conversation] Unable to save conversation", error)
    return Response.json({ message: "Your response is ready, but conversation history could not be saved." }, { status: 503 })
  }
}

export async function DELETE() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return Response.json({ message: "Unauthorized" }, { status: 401 })
  try {
    await db.del(conversationKey(session.user.id))
    return Response.json({ cleared: true }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    console.error("[ai-conversation] Unable to clear conversation", error)
    return Response.json({ message: "Unable to clear saved conversation." }, { status: 503 })
  }
}
