import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { isSuperAdminEmail } from "@/lib/superadmin"
import { getServerSession } from "next-auth"
import { nanoid } from "nanoid"
import { z } from "zod"

export const dynamic = "force-dynamic"

async function requireSuperAdmin() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id || !isSuperAdminEmail(session.user.email)) return null
  return session.user
}

export async function GET(req: Request) {
  const actor = await requireSuperAdmin()
  if (!actor) return Response.json({ message: "Not found" }, { status: 404 })

  try {
    const url = new URL(req.url)
    const query = (url.searchParams.get("q") || "").trim().toLowerCase().slice(0, 100)
    const offset = Math.max(0, Math.min(10000, Number(url.searchParams.get("offset") || 0) || 0))
    const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") || 50) || 50))
    const userIds = await db.smembers("users") as string[]
    const ids = Array.from(new Set(userIds || []))
    const pipeline = db.pipeline()
    ids.forEach(id => pipeline.get(`user:${id}`))
    const rows = ids.length ? await pipeline.exec() : []
    const users = rows.flatMap((raw, index) => {
      try {
        const value = typeof raw === "string" ? JSON.parse(raw) : raw
        if (!value?.id || value.id !== ids[index]) return []
        const user = {
          id: value.id,
          name: value.name || "Unknown user",
          email: value.email || "",
          image: value.image || "",
          createdAt: value.createdAt || null,
          suspendedAt: value.suspendedAt || null,
          isSuperAdmin: isSuperAdminEmail(value.email),
        }
        if (query && !user.name.toLowerCase().includes(query) && !user.email.toLowerCase().includes(query)) return []
        return [user]
      } catch { return [] }
    }).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))

    const communityIds = await db.smembers("communities") as string[]
    const groupIds = new Set<string>()
    const groupIndexPipeline = db.pipeline()
    ids.forEach(id => groupIndexPipeline.smembers(`user:${id}:groups`))
    const groupIndexes = ids.length ? await groupIndexPipeline.exec() : []
    for (const value of groupIndexes) {
      if (Array.isArray(value)) value.forEach(id => groupIds.add(String(id)))
    }

    return Response.json({
      stats: {
        users: ids.length,
        groups: groupIds.size,
        communities: (communityIds || []).length,
        suspendedUsers: users.filter(user => user.suspendedAt).length,
      },
      users: users.slice(offset, offset + limit),
      pagination: { offset, limit, total: users.length },
    })
  } catch (error) {
    console.error("[superadmin] overview failed", error)
    return Response.json({ message: "Unable to load administration data" }, { status: 500 })
  }
}

const moderationSchema = z.object({
  action: z.enum(["suspend", "restore"]),
  userId: z.string().trim().min(1).max(128),
})

export async function PATCH(req: Request) {
  const actor = await requireSuperAdmin()
  if (!actor) return Response.json({ message: "Not found" }, { status: 404 })

  try {
    const parsed = moderationSchema.safeParse(await req.json())
    if (!parsed.success) return Response.json({ message: "Invalid moderation request" }, { status: 400 })
    const { action, userId } = parsed.data
    if (userId === actor.id) return Response.json({ message: "You cannot suspend your own SuperAdmin account" }, { status: 400 })

    const key = `user:${userId}`
    const raw = await db.get(key)
    if (!raw) return Response.json({ message: "User not found" }, { status: 404 })
    const user = (typeof raw === "string" ? JSON.parse(raw) : raw) as Record<string, unknown>
    if (isSuperAdminEmail(typeof user.email === "string" ? user.email : null)) {
      return Response.json({ message: "SuperAdmin accounts cannot be suspended through user moderation" }, { status: 403 })
    }

    const now = Date.now()
    if (action === "suspend") user.suspendedAt = now
    else delete user.suspendedAt
    await db.set(key, JSON.stringify(user))
    await db.set(`superadmin:audit:${now}:${nanoid(8)}`, JSON.stringify({
      actorId: actor.id, actorEmail: actor.email, action, targetUserId: userId, timestamp: now,
    }), { ex: 60 * 60 * 24 * 180 })

    return Response.json({ success: true, action, user: { id: userId, suspendedAt: user.suspendedAt || null } })
  } catch (error) {
    console.error("[superadmin] moderation failed", error)
    return Response.json({ message: "Unable to update account status" }, { status: 500 })
  }
}
