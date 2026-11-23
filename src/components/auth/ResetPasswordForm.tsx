"use client"

import { FormEvent, useState } from "react"
import axios from "axios"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Loader2, Lock, MessageCircleCode } from "lucide-react"
import toast from "react-hot-toast"

export default function ResetPasswordForm({ token, email }: { token: string; email: string }) {
  const router = useRouter()
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    if (password !== confirm) { toast.error("Passwords do not match."); return }
    setBusy(true)
    try {
      const response = await axios.post("/api/auth/password-reset/confirm", { token, email, password })
      setDone(true)
      toast.success(response.data?.message || "Password updated.")
      window.setTimeout(() => router.replace("/login"), 900)
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "This reset link is invalid or expired.")
    } finally { setBusy(false) }
  }

  const validLink = /^[a-f0-9]{64}$/.test(token) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)

  return <main className="flex min-h-screen items-center justify-center bg-slate-950 p-4">
    <div className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900/90 p-7 shadow-2xl">
      <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600"><MessageCircleCode className="text-white"/></div>
      <h1 className="text-center text-2xl font-bold text-white">Choose a new password</h1>
      <p className="mt-2 text-center text-sm text-slate-400">Use at least 8 characters, including uppercase, lowercase, a number and a symbol.</p>
      {!validLink ? <div role="alert" className="mt-6 rounded-xl border border-rose-800 bg-rose-950/30 p-4 text-sm text-rose-200">This reset link is invalid. Request a new one.</div> : done ? <div role="status" className="mt-6 rounded-xl border border-emerald-800 bg-emerald-950/30 p-4 text-sm text-emerald-200">Your password was updated. Redirecting to sign in…</div> : <form onSubmit={submit} className="mt-6 space-y-4">
        <label htmlFor="new-password" className="block text-xs font-medium text-slate-300">New password</label>
        <div className="relative"><Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"/><input id="new-password" type="password" required minLength={8} maxLength={72} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-950 py-3 pl-10 pr-3 text-sm text-white outline-none focus:border-indigo-500"/></div>
        <label htmlFor="confirm-new-password" className="block text-xs font-medium text-slate-300">Confirm new password</label>
        <input id="confirm-new-password" type="password" required minLength={8} maxLength={72} autoComplete="new-password" value={confirm} onChange={event => setConfirm(event.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-white outline-none focus:border-indigo-500"/>
        <button type="submit" disabled={busy || password.length < 8 || password !== confirm} className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50">{busy && <Loader2 size={16} className="animate-spin"/>} Update password</button>
      </form>}
      <Link href="/forgot-password" className="mt-6 block text-center text-sm font-medium text-indigo-300 hover:text-indigo-200">Request another reset link</Link>
    </div>
  </main>
