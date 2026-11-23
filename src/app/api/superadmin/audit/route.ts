import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { isSuperAdminEmail } from "@/lib/superadmin"
import { getServerSession } from "next-auth"

export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id || !isSuperAdminEmail(session.user.email)) {
    return Response.json({ message: "Not found" }, { status: 404 })
  }

  try {
    const url = new URL(req.url)
    const limit = Math.max(1, Math.min(50, Number(url.searchParams.get("limit") || 25) || 25))
    const keys = await db.zrange("superadmin:audit:index", -limit, -1) as string[]
    const newestFirst = (keys || []).slice().reverse()
    if (!newestFirst.length) return Response.json({ events: [] })

    const pipeline = db.pipeline()
    newestFirst.forEach(key => pipeline.get(key))
    const rows = await pipeline.exec()
    const events = rows.flatMap(raw => {
      try {
        const value = typeof raw === "string" ? JSON.parse(raw) : raw
        if (!value || typeof value !== "object" || typeof value.timestamp !== "number" ||
            typeof value.action !== "string" || typeof value.actorId !== "string") return []
        return [{
          timestamp: value.timestamp,
          action: value.action.slice(0, 40),
          actorEmail: typeof value.actorEmail === "string" ? value.actorEmail.slice(0, 160) : "Platform administrator",
          targetUserId: typeof value.targetUserId === "string" ? value.targetUserId.slice(0, 128) : null,
        }]
      } catch { return [] }
    })
    return Response.json({ events })
  } catch (error) {
    console.error("[superadmin] audit feed failed", error instanceof Error ? error.name : "UnknownError")
    return Response.json({ message: "Unable to load administrative activity" }, { status: 500 })
  }
}