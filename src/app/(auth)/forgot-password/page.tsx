import { Suspense } from "react"
import type { Metadata } from "next"
import ForgotPasswordForm from "@/components/auth/ForgotPasswordForm"

export const metadata: Metadata = { title: "Forgot password | Chat+" }

export default function ForgotPasswordPage() {
  return <Suspense fallback={<main className="flex min-h-screen items-center justify-center bg-slate-950 text-sm text-slate-400">Loading…</main>}><ForgotPasswordForm /></Suspense>
}
