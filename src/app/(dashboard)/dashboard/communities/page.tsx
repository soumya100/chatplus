import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import WhatsAppCommunities from "@/components/Chat/WhatsAppCommunities"

export const dynamic = "force-dynamic"

export default async function CommunitiesPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) redirect("/login")
  const ids = (session.user.isSuperAdmin ? await db.smembers("groups") : await db.smembers(`user:${session.user.id}:groups`)) as string[]
  const groups: Group[] = []
  if (ids?.length) {
    const pipeline = db.pipeline()
    ids.forEach(id => pipeline.get(`group:${id}`))
    const rows = await pipeline.exec()
    rows.forEach(raw => {
      try {
        const value = typeof raw === "string" ? JSON.parse(raw) : raw
        if (value) groups.push(value as Group)
      } catch {}
    })
  }
  return <WhatsAppCommunities groups={groups} sessionId={session.user.id} />
}
