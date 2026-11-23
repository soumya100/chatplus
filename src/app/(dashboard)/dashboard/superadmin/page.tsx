import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { isSuperAdminEmail } from "@/lib/superadmin"
import SuperAdminDashboard from "@/components/superadmin/SuperAdminDashboard"

export const dynamic = "force-dynamic"

export default async function SuperAdminPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) redirect("/login")
  if (!isSuperAdminEmail(session.user.email)) redirect("/dashboard")
  return <SuperAdminDashboard />
}
