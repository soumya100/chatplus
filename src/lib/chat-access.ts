/** Enforce current chat access before any message read or mutation. */
type ChatAccessRedis = {
    sismember(key: string, member: string): Promise<number | boolean>
    get?(key: string): Promise<unknown>
}

import { isSuperAdminEmail } from "@/lib/superadmin"

export async function hasCurrentChatAccess(db: ChatAccessRedis, chatId: string, userId: string): Promise<boolean> {
    if (!userId || !chatId || chatId.length > 256) return false
    if (chatId.startsWith("group--")) {
        const groupId = chatId.slice("group--".length)
        if (!groupId) return false
        // System administrators can inspect group conversations for platform moderation.
        // Direct conversations remain private and are never covered by this exception.
        if (db.get) {
            const rawUser = await db.get(`user:${userId}`)
            try {
                const user = typeof rawUser === "string" ? JSON.parse(rawUser) : rawUser as any
                if (isSuperAdminEmail(user?.email)) return true
            } catch {}
        }
        return Number(await db.sismember(`group:${groupId}:members`, userId)) === 1
    }
    const ids = chatId.split("--")
    if (ids.length !== 2 || !ids[0] || !ids[1] || !ids.includes(userId)) return false
    const friendId = ids[0] === userId ? ids[1] : ids[0]
    return Number(await db.sismember(`user:${userId}:friends`, friendId)) === 1
}
