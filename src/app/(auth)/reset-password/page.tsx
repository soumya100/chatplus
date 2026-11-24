import type { Metadata } from "next"
import ResetPasswordForm from "@/components/auth/ResetPasswordForm"

export const metadata: Metadata = { title: "Reset password | Chat+", referrer: "no-referrer" }

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string; email?: string }> }) {
  const params = await searchParams
  return <ResetPasswordForm token={params.token || ""} email={params.email || ""} />
}
