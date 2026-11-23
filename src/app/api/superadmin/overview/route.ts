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
    const suspendedUsers = rows.filter(raw => { try { const value = typeof raw === "string" ? JSON.parse(raw) : raw; return Boolean(value?.suspendedAt) } catch { return false } }).length
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

    const [indexedCommunities, indexedGroups] = await Promise.all([
      db.smembers("communities") as Promise<string[]>,
      db.smembers("groups") as Promise<string[]>,
    ])
    const communityIdSet = new Set<string>(indexedCommunities || [])
    const communityIndexPipeline = db.pipeline()
    ids.forEach(id => communityIndexPipeline.smembers(`user:${id}:communities`))
    const communityIndexes = ids.length ? await communityIndexPipeline.exec() : []
    for (const value of communityIndexes) if (Array.isArray(value)) value.forEach(id => communityIdSet.add(String(id)))
    const communityIds = Array.from(communityIdSet)
    const groupIds = new Set<string>(indexedGroups || [])
    const groupIndexPipeline = db.pipeline()
    ids.forEach(id => groupIndexPipeline.smembers(`user:${id}:groups`))
    const groupIndexes = ids.length ? await groupIndexPipeline.exec() : []
    for (const value of groupIndexes) {
      if (Array.isArray(value)) value.forEach(id => groupIds.add(String(id)))
    }
    const allGroupIds = Array.from(groupIds)
    const groupPipeline = db.pipeline()
    allGroupIds.forEach(id => groupPipeline.get(`group:${id}`))
    const groupRows = allGroupIds.length ? await groupPipeline.exec() : []
    const groups = groupRows.flatMap((raw, index) => { try { const group = typeof raw === "string" ? JSON.parse(raw) : raw; return group?.id === allGroupIds[index] ? [{ id: group.id, name: group.name || "Untitled group", memberCount: (group.memberIds || []).length, communityId: group.communityId || null }] : [] } catch { return [] } })
    const communityPipeline = db.pipeline()
    ;(communityIds || []).forEach(id => communityPipeline.get(`community:${id}`))
    const communityRows = communityIds?.length ? await communityPipeline.exec() : []
    const communities = communityRows.flatMap((raw, index) => { try { const community = typeof raw === "string" ? JSON.parse(raw) : raw; return community?.id === communityIds[index] ? [{ id: community.id, name: community.name || "Untitled community", memberCount: (community.memberIds || []).length, groupCount: (community.groupIds || []).length }] : [] } catch { return [] } })

    return Response.json({
      stats: {
        users: ids.length,
        groups: groupIds.size,
        communities: (communityIds || []).length,
        suspendedUsers,
      },
      users: users.slice(offset, offset + limit),
      groups: groups.slice(0, 100),
      communities: communities.slice(0, 100),
      pagination: { offset, limit, total: users.length },
    })
  } catch (error) {
    console.error("[superadmin] overview failed", error)
    return Response.json({ message: "Unable to load administration data" }, { status: 500 })
  }
}

const atomicUserModeration = `
-- superadmin-user-moderation-cas-v1
local current = redis.call("GET", KEYS[1])
if not current or current ~= ARGV[1] then return 0 end
redis.call("SET", KEYS[1], ARGV[2])
return 1
`

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
    let moderatedUser: Record<string, unknown> | null = null
    for (let attempt = 0; attempt < 4; attempt++) {
      const raw = await db.get(key)
      if (!raw) return Response.json({ message: "User not found" }, { status: 404 })
      const expected = typeof raw === "string" ? raw : JSON.stringify(raw)
      const user = (typeof raw === "string" ? JSON.parse(raw) : raw) as Record<string, unknown>
      if (isSuperAdminEmail(typeof user.email === "string" ? user.email : null)) {
        return Response.json({ message: "SuperAdmin accounts cannot be suspended through user moderation" }, { status: 403 })
      }

      const now = Date.now()
      if (action === "suspend") user.suspendedAt = now
      else delete user.suspendedAt
      const committed = await db.eval(atomicUserModeration, [key], [expected, JSON.stringify(user)])
      if (Number(committed) === 1) {
        moderatedUser = user
        await db.set(`superadmin:audit:${now}:${nanoid(8)}`, JSON.stringify({
          actorId: actor.id, actorEmail: actor.email, action, targetUserId: userId, timestamp: now,
        }), { ex: 60 * 60 * 24 * 180 })
        break
      }
    }
    if (!moderatedUser) return Response.json({ message: "Account changed concurrently. Refresh and retry." }, { status: 409 })

    return Response.json({ success: true, action, user: { id: userId, suspendedAt: moderatedUser.suspendedAt || null } })
  } catch (error) {
    console.error("[superadmin] moderation failed", error)
    return Response.json({ message: "Unable to update account status" }, { status: 500 })
  }
}
