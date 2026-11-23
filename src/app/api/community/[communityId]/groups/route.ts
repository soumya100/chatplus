import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { pusherServer } from "@/lib/pusher"
import { toPusherKey } from "@/lib/utils"
import { generateInitialsAvatar } from "@/lib/avatars"
import { rateLimit } from "@/lib/ratelimit"
import { getServerSession } from "next-auth"
import { nanoid } from "nanoid"
import { z } from "zod"

export const dynamic = "force-dynamic"

const schema = z.object({
  name: z.string().trim().min(2).max(50),
  description: z.string().trim().max(500).optional(),
  memberIds: z.array(z.string().min(1).max(128)).max(254).default([]).refine(ids => new Set(ids).size === ids.length, "A member can only be selected once"),
})

const createCommunityGroup = `
-- create-community-group-cas-v1
local current = redis.call("GET", KEYS[1])
if not current or current ~= ARGV[1] then return 0 end
redis.call("SET", KEYS[1], ARGV[2])
redis.call("SET", KEYS[2], ARGV[3])
redis.call("SADD", KEYS[3], ARGV[5])
local members = cjson.decode(ARGV[4])
for index, memberId in ipairs(members) do
  redis.call("SADD", KEYS[4], memberId)
  redis.call("SADD", KEYS[4 + index], ARGV[5])
end
redis.call("SADD", KEYS[#KEYS], ARGV[6])
return 1
`

function decode<T>(raw: unknown): T {
  return (typeof raw === "string" ? JSON.parse(raw) : raw) as T
}

export async function POST(req: Request, { params }: { params: Promise<{ communityId: string }> }) {
  try {
    const { communityId } = await params
    const session = await getServerSession(authOptions)
    const userId = session?.user?.id
    const isSuperAdmin = Boolean(session?.user?.isSuperAdmin)
    if (!userId) return Response.json({ message: "Unauthorized" }, { status: 401 })

    const parsed = schema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return Response.json({ message: parsed.error.issues[0]?.message || "Invalid group details" }, { status: 400 })
    const limiter = await rateLimit(userId, "community-group-create", { limit: 10, windowSeconds: 300 })
    if (!limiter.success) return Response.json({ message: "Too many groups created. Please wait and try again." }, { status: 429 })

    const raw = await db.get(`community:${communityId}`)
    if (!raw) return Response.json({ message: "Community not found" }, { status: 404 })
    const expected = typeof raw === "string" ? raw : JSON.stringify(raw)
    const community = decode<any>(raw)
    if (!(community.memberIds || []).includes(userId) && !isSuperAdmin) return Response.json({ message: "Not a community member" }, { status: 403 })
    if (!(community.adminIds || [community.ownerId]).includes(userId) && !isSuperAdmin) return Response.json({ message: "Only community admins can create groups" }, { status: 403 })
    if ((community.groupIds || []).length >= 20) return Response.json({ message: "A community can contain up to 20 groups" }, { status: 400 })

    const selectedMembers = parsed.data.memberIds
    const allowedMembers = new Set(community.memberIds || [])
    if (selectedMembers.some(id => !allowedMembers.has(id))) return Response.json({ message: "Every selected person must already belong to this community" }, { status: 400 })

    const communityMemberIds = Array.from(new Set([...(community.memberIds || []), userId]))
    if (communityMemberIds.length > 2000) return Response.json({ message: "This community has reached its 2,000 member limit" }, { status: 400 })
    const memberIds = Array.from(new Set([userId, ...selectedMembers]))
    if (memberIds.length > 255) return Response.json({ message: "A group can contain up to 255 members" }, { status: 400 })
    const groupId = nanoid(10)
    const now = Date.now()
    const group: Group = {
      id: groupId,
      name: parsed.data.name,
      description: parsed.data.description || "",
      creatorId: userId,
      adminIds: [userId],
      memberIds,
      image: generateInitialsAvatar(parsed.data.name, "#8b5cf6", "#ec4899"),
      communityId,
      createdAt: now,
      updatedAt: now,
      settings: {
        onlyAdminsCanEditInfo: false,
        onlyAdminsCanAddMembers: false,
        onlyAdminsCanSendMessages: false,
        approvalRequired: false,
      },
    }

    const nextCommunity = {
      ...community,
      groupIds: [...(community.groupIds || []), groupId],
      memberIds: communityMemberIds,
      updatedAt: now,
    }
    const keys = [
      `community:${communityId}`,
      `group:${groupId}`,
      "groups",
      `group:${groupId}:members`,
      ...memberIds.map(id => `user:${id}:groups`),
      `user:${userId}:communities`,
    ]
    const committed = await db.eval(createCommunityGroup, keys, [
      expected,
      JSON.stringify(nextCommunity),
      JSON.stringify(group),
      JSON.stringify(memberIds),
      groupId,
      communityId,
    ])
    if (Number(committed) !== 1) return Response.json({ message: "The community changed while creating this group. Refresh and try again." }, { status: 409 })

    await Promise.allSettled(memberIds.map(memberId => pusherServer.trigger(
      toPusherKey(`private-user:${memberId}:groups`),
      "new_group",
      group,
    )))
    return Response.json({ success: true, group, community: nextCommunity }, { status: 201 })
  } catch (error) {
    console.error("[community-group] create failed", error)
    return Response.json({ message: "Unable to create a group in this community" }, { status: 500 })
  }
}
