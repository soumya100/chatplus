import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { getServerSession } from "next-auth"
import { nanoid } from "nanoid"
import { z } from "zod"

export const dynamic = "force-dynamic"

const createSchema = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(500).optional(),
  groupIds: z.array(z.string().min(1)).max(20).default([]).refine(ids => new Set(ids).size === ids.length, "A group can only be selected once"),
})

const atomicCreateCommunity = `
-- create-community-cas-v1
local expectedGroups = cjson.decode(ARGV[2])
local updatedGroups = cjson.decode(ARGV[3])
for index, expected in ipairs(expectedGroups) do
  if redis.call("GET", KEYS[2 + index]) ~= expected then return 0 end
end
redis.call("SET", KEYS[1], ARGV[1])
local community = cjson.decode(ARGV[1])
redis.call("SADD", KEYS[2], community.id)
for index, updated in ipairs(updatedGroups) do
  redis.call("SET", KEYS[2 + index], updated)
end
local memberIds = cjson.decode(ARGV[4])
for index, memberId in ipairs(memberIds) do
  redis.call("SADD", KEYS[2 + #updatedGroups + index], community.id)
end
return 1
`;

export async function GET() {
  const session = await getServerSession(authOptions)
  const userId = session?.user?.id
  const isSuperAdmin = Boolean(session?.user?.isSuperAdmin)
  if (!userId) return Response.json({ message: "Unauthorized" }, { status: 401 })

  let communityIds: string[] = []
  if (isSuperAdmin) {
    const [indexed, allUsers] = await Promise.all([
      db.smembers("communities") as Promise<string[]>,
      db.smembers("users") as Promise<string[]>,
    ])
    communityIds = Array.from(new Set(indexed || []))
    const indexes = allUsers?.length
      ? await Promise.all(allUsers.map(id => db.smembers(`user:${id}:communities`)))
      : []
    indexes.forEach(value => { if (Array.isArray(value)) value.forEach(id => communityIds.push(String(id))) })
    communityIds = Array.from(new Set(communityIds))
  } else {
    communityIds = await db.smembers(`user:${userId}:communities`) as string[]
  }
  const [ids, inviteIds] = await Promise.all([
    Promise.resolve(communityIds),
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
    members: (community.memberIds || []).map((id: string) => memberMap.get(id)).filter(Boolean),
  }))
  const invites = (inviteIds || []).flatMap(id => byId.has(id) ? [byId.get(id)] : [])
  return Response.json({ communities: enrichedCommunities, invites })
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  const userId = session?.user?.id
  const isSuperAdmin = Boolean(session?.user?.isSuperAdmin)
  if (!userId) return Response.json({ message: "Unauthorized" }, { status: 401 })
  const parsed = createSchema.safeParse(await req.json())
  if (!parsed.success) return Response.json({ message: parsed.error.issues[0]?.message || "Invalid community" }, { status: 400 })
  const { name, description, groupIds } = parsed.data
  const groups: Group[] = []
  const expectedGroups: string[] = []
  const memberIds = new Set<string>([userId])

  for (const id of groupIds) {
    const raw = await db.get(`group:${id}`)
    if (!raw) return Response.json({ message: `Group ${id} not found` }, { status: 404 })
    const group = (typeof raw === "string" ? JSON.parse(raw) : raw) as Group
    if (!(group.adminIds || [group.creatorId]).includes(userId) && !isSuperAdmin) return Response.json({ message: "Only admins of every selected group can add it to a community" }, { status: 403 })
    if (group.communityId) return Response.json({ message: "A selected group already belongs to a community. Remove it there before creating this community." }, { status: 409 })
    groups.push(group)
    expectedGroups.push(typeof raw === "string" ? raw : JSON.stringify(raw))
    ;(group.memberIds || []).forEach(id => memberIds.add(id))
    memberIds.add(group.creatorId)
    if (memberIds.size > 2000) return Response.json({ message: "A community can contain up to 2,000 members. Select fewer groups." }, { status: 400 })
  }

  const id = nanoid()
  const members = Array.from(memberIds)
  const community = {
    id, name, description: description || "", ownerId: userId, adminIds: [userId],
    memberIds: members, groupIds, announcements: [], createdAt: Date.now(), updatedAt: Date.now(),
  }
  const updatedGroups = groups.map(group => JSON.stringify({ ...group, communityId: id, updatedAt: Date.now() }))
  const keys = [
    `community:${id}`, "communities",
    ...groupIds.map(groupId => `group:${groupId}`),
    ...members.map(memberId => `user:${memberId}:communities`),
  ]
  const committed = await db.eval(atomicCreateCommunity, keys, [
    JSON.stringify(community),
    JSON.stringify(expectedGroups),
    JSON.stringify(updatedGroups),
    JSON.stringify(members),
  ])
  if (Number(committed) !== 1) {
    return Response.json({ message: "A selected group changed while the community was being created. Refresh and try again." }, { status: 409 })
  }
  return Response.json({ success: true, community }, { status: 201 })
}
