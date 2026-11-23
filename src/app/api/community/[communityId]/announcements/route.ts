import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { getServerSession } from "next-auth"
import { nanoid } from "nanoid"
import { z } from "zod"

export const dynamic = "force-dynamic"

const appendAnnouncement = `
-- community-announcement-cas-v1
local current = redis.call("GET", KEYS[1])
if current ~= ARGV[1] then return 0 end
redis.call("SET", KEYS[1], ARGV[2])
return 1
`

function decode<T>(raw: unknown): T {
  return (typeof raw === "string" ? JSON.parse(raw) : raw) as T
}

export async function GET(_req: Request, { params }: { params: Promise<{ communityId: string }> }) {
  const { communityId } = await params
  const session = await getServerSession(authOptions)
  const userId = session?.user?.id
  const isSuperAdmin = Boolean(session?.user?.isSuperAdmin)
  if (!userId) return Response.json({ message: "Unauthorized" }, { status: 401 })
  const raw = await db.get(`community:${communityId}`)
  if (!raw) return Response.json({ message: "Community not found" }, { status: 404 })
  const community = decode<any>(raw)
  if (!(community.memberIds || []).includes(userId) && !isSuperAdmin) return Response.json({ message: "Not a community member" }, { status: 403 })
  return Response.json({ announcements: (community.announcements || []).slice(-100).reverse() })
}

const schema = z.object({ text: z.string().trim().min(1).max(2000) })

export async function POST(req: Request, { params }: { params: Promise<{ communityId: string }> }) {
  const { communityId } = await params
  const session = await getServerSession(authOptions)
  const userId = session?.user?.id
  if (!userId) return Response.json({ message: "Unauthorized" }, { status: 401 })
  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return Response.json({ message: "Announcement must contain 1–2000 characters" }, { status: 400 })

  for (let attempt = 0; attempt < 4; attempt++) {
    const raw = await db.get(`community:${communityId}`)
    if (!raw) return Response.json({ message: "Community not found" }, { status: 404 })
    const expected = typeof raw === "string" ? raw : JSON.stringify(raw)
    const community = decode<any>(raw)
    if (!(community.memberIds || []).includes(userId) && !isSuperAdmin) return Response.json({ message: "Not a community member" }, { status: 403 })
    if (!(community.adminIds || [community.ownerId]).includes(userId) && !isSuperAdmin) return Response.json({ message: "Only community admins can post announcements" }, { status: 403 })

    const announcement = {
      id: nanoid(12),
      authorId: userId,
      authorName: session.user.name || "Community admin",
      text: parsed.data.text,
      createdAt: Date.now(),
    }
    const next = { ...community, announcements: [...(community.announcements || []), announcement].slice(-100), updatedAt: Date.now() }
    const result = await db.eval(appendAnnouncement, [`community:${communityId}`], [expected, JSON.stringify(next)])
    if (Number(result) === 1) return Response.json({ success: true, announcement }, { status: 201 })
  }
  return Response.json({ message: "Community changed concurrently. Please retry." }, { status: 409 })
}
