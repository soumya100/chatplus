import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { getServerSession } from "next-auth"
import { nanoid } from "nanoid"
import { z } from "zod"

export const dynamic = "force-dynamic"

const createSchema = z.object({ name: z.string().trim().min(2).max(60), description: z.string().trim().max(500).optional(), groupIds: z.array(z.string().min(1)).max(50).default([]) })

export async function GET() {
  const session = await getServerSession(authOptions)
  const userId = session?.user?.id
  const isSuperAdmin = Boolean(session?.user?.isSuperAdmin)
  if (!userId) return Response.json({ message: "Unauthorized" }, { status: 401 })

  const [ids, inviteIds] = await Promise.all([
    (isSuperAdmin ? db.smembers("communities") : db.smembers(`user:${userId}:communities`)) as Promise<string[]>,
    (isSuperAdmin ? Promise.resolve([]) : db.smembers(`user:${userId}:community-invites`)) as Promise<string[]>
  ])
  const allIds = Array.from(new Set([...(ids || []), ...(inviteIds || [])]))
  if (!allIds.length) return Response.json({ communities: [], invites: [] })
  const pipeline = db.pipeline()
  allIds.forEach(id => pipeline.get(`community:${id}`))
  const rows = await pipeline.exec()
  const byId = new Map<string, any>()
  rows.forEach((raw, index) => {
    try {
      const value = typeof raw === "string" ? JSON.parse(raw) : raw
      if (value) byId.set(allIds[index], value)
    } catch {}
  })
  const communities = (ids || []).flatMap(id => byId.has(id) ? [{ ...byId.get(id), isAdmin: isSuperAdmin || (byId.get(id).adminIds || [byId.get(id).ownerId]).includes(userId), isOwner: byId.get(id).ownerId === userId, isSuperAdmin }] : [])
  const memberIds = Array.from(new Set(communities.flatMap(community => community.memberIds || [])))
  const memberPipeline = db.pipeline()
  memberIds.forEach(id => memberPipeline.get(`user:${id}`))
  const memberRows = memberIds.length ? await memberPipeline.exec() : []
  const memberMap = new Map<string, { id: string; name: string; image: string }>()
  memberRows.forEach((raw, index) => {
    try {
      const user = typeof raw === "string" ? JSON.parse(raw) : raw
      if (user?.id === memberIds[index]) memberMap.set(user.id, { id: user.id, name: user.name || "Chat+ member", image: user.image || "" })
    } catch {}
  })
  const enrichedCommunities = communities.map(community => ({
    ...community,
    members: (community.memberIds || []).map(id => memberMap.get(id)).filter(Boolean),
  }))
  const invites = (inviteIds || []).flatMap(id => byId.has(id) ? [byId.get(id)] : [])
  return Response.json({ communities: enrichedCommunities, invites })
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  const userId = session?.user?.id
  if (!userId) return Response.json({ message: "Unauthorized" }, { status: 401 })
  const parsed = createSchema.safeParse(await req.json())
  if (!parsed.success) return Response.json({ message: parsed.error.issues[0]?.message || "Invalid community" }, { status: 400 })
  const { name, description, groupIds } = parsed.data
  const groups: Group[] = []
  const memberIds = new Set<string>([userId])

  for (const id of groupIds) {
    const raw = await db.get(`group:${id}`)
    if (!raw) return Response.json({ message: `Group ${id} not found` }, { status: 404 })
    const group = (typeof raw === "string" ? JSON.parse(raw) : raw) as Group
    if (!(group.adminIds || [group.creatorId]).includes(userId)) return Response.json({ message: "Only admins of every selected group can add it to a community" }, { status: 403 })
    if (group.communityId) return Response.json({ message: "A selected group already belongs to a community. Remove it there before creating this community." }, { status: 409 })
    groups.push(group)
    ;(group.memberIds || []).forEach(id => memberIds.add(id))
    memberIds.add(group.creatorId)
  }

  const id = nanoid()
  const members = Array.from(memberIds)
  const community = { id, name, description: description || "", ownerId: userId, adminIds: [userId], memberIds: members, groupIds, createdAt: Date.now(), updatedAt: Date.now() }
  const pipeline = db.pipeline()
  pipeline.set(`community:${id}`, JSON.stringify({ ...community, announcements: [] }))
  pipeline.sadd("communities", id)
  for (const memberId of members) pipeline.sadd(`user:${memberId}:communities`, id)
  for (const group of groups) {
    pipeline.set(`group:${group.id}`, JSON.stringify({ ...group, communityId: id, updatedAt: Date.now() }))
  }
  await pipeline.exec()
  return Response.json({ success: true, community }, { status: 201 })
}
