"use client"

import { FormEvent, useState } from "react"
import axios from "axios"
import Link from "next/link"
import { Loader2, Mail, MessageCircleCode } from "lucide-react"
import toast from "react-hot-toast"

export default function ForgotPasswordForm() {
  const [email, setEmail] = useState("")
  const [busy, setBusy] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      const response = await axios.post("/api/auth/password-reset/request", { email: email.trim().toLowerCase() })
      setSubmitted(true)
      toast.success(response.data?.message || "If your account exists, reset instructions are on their way.")
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Unable to request a reset right now.")
    } finally { setBusy(false) }
  }

  return <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 p-4">
    <div className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900/90 p-7 shadow-2xl">
      <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600"><MessageCircleCode className="text-white"/></div>
      <h1 className="text-center text-2xl font-bold text-white">Forgot your password?</h1>
      <p className="mt-2 text-center text-sm text-slate-400">Enter the email address associated with your Chat+ account.</p>
      {submitted ? <div role="status" className="mt-6 rounded-xl border border-emerald-800 bg-emerald-950/30 p-4 text-sm leading-relaxed text-emerald-200">If an account matches that email, password reset instructions will be sent shortly. Check your inbox and spam folder.</div> : <form onSubmit={submit} className="mt-6 space-y-4">
        <label htmlFor="reset-request-email" className="block text-xs font-medium text-slate-300">Email address</label>
        <div className="relative"><Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"/><input id="reset-request-email" type="email" required autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="name@example.com" className="w-full rounded-xl border border-slate-700 bg-slate-950 py-3 pl-10 pr-3 text-sm text-white outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"/></div>
        <button type="submit" disabled={busy || !email.trim()} className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50">{busy && <Loader2 size={16} className="animate-spin"/>} Send reset link</button>
      </form>}
      <Link href="/login" className="mt-6 block text-center text-sm font-medium text-indigo-300 hover:text-indigo-200">Back to sign in</Link>
    </div>
  </main>
}
