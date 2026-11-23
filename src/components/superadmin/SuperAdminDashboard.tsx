"use client"

import { useCallback, useEffect, useState } from "react"
import axios from "axios"
import Link from "next/link"
import toast from "react-hot-toast"
import { Activity, Ban, CheckCircle2, RefreshCw, Search, ShieldCheck, Users, UsersRound, Network } from "lucide-react"

type AdminUser = { id: string; name: string; email: string; image?: string; createdAt?: number | null; suspendedAt?: number | null; isSuperAdmin: boolean }
type AuditEvent = { timestamp: number; action: string; actorEmail: string; targetUserId?: string | null }
type Overview = { stats: { users: number; groups: number; communities: number; suspendedUsers: number }; users: AdminUser[]; groups: {id:string;name:string;memberCount:number;communityId?:string|null}[]; communities: {id:string;name:string;memberCount:number;groupCount:number}[]; pagination: { offset: number; limit: number; total: number } }

export default function SuperAdminDashboard() {
  const [data, setData] = useState<Overview | null>(null)
  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [offset, setOffset] = useState(0)
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([])
  const [auditLoading, setAuditLoading] = useState(true)

  const load = useCallback(async (search = "", pageOffset = 0) => {
    setLoading(true)
    try {
      const response = await axios.get("/api/superadmin/overview", { params: { q: search, limit: 100, offset: pageOffset } })
      setData(response.data)
      setOffset(pageOffset)
      try {
        const auditResponse = await axios.get("/api/superadmin/audit", { params: { limit: 25 } })
        setAuditEvents(auditResponse.data.events || [])
      } catch {
        setAuditEvents([])
      }
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Unable to load the SuperAdmin dashboard")
    } finally { setLoading(false); setAuditLoading(false) }
  }, [])

  useEffect(() => { void load("") }, [load])

  const moderate = async (user: AdminUser) => {
    const action = user.suspendedAt ? "restore" : "suspend"
    setBusyId(user.id)
    try {
      await axios.patch("/api/superadmin/overview", { action, userId: user.id })
      toast.success(action === "suspend" ? "Account suspended" : "Account restored")
      await load(query, offset)
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Unable to update account")
    } finally { setBusyId(null) }
  }

  const stats = data?.stats
  const cards = [
    { label: "Registered users", value: stats?.users ?? "—", icon: Users },
    { label: "Group chats", value: stats?.groups ?? "—", icon: UsersRound },
    { label: "Communities", value: stats?.communities ?? "—", icon: Network },
    { label: "Suspended accounts", value: stats?.suspendedUsers ?? "—", icon: Ban },
  ]

  return <main className="mx-auto max-w-7xl space-y-7 p-4 sm:p-7">
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div><div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600 dark:text-indigo-300"><ShieldCheck size={15}/> System administration</div><h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 dark:text-white">SuperAdmin control center</h1><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Platform-wide visibility and account governance. Every privileged action is authorized server-side and audit logged.</p></div>
      <button type="button" onClick={() => void load(query, offset)} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/5"><RefreshCw size={15} className={loading ? "animate-spin" : ""}/> Refresh</button>
    </header>
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map(card => <article key={card.label} className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-slate-900"><div className="flex items-center justify-between text-sm text-slate-500 dark:text-slate-400"><span>{card.label}</span><card.icon size={17}/></div><p className="mt-3 text-3xl font-bold tabular-nums text-slate-900 dark:text-white">{card.value}</p></article>)}
    </section>
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-white/10 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4 dark:border-white/10"><div><h2 className="font-semibold text-slate-900 dark:text-white">Account directory</h2><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Search users and suspend or restore non-SuperAdmin accounts.</p></div><form className="flex gap-2" onSubmit={event => {event.preventDefault(); void load(query, 0)}}><label className="relative"><span className="sr-only">Search users</span><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Name or email" className="w-56 max-w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm outline-none focus:border-indigo-400 dark:border-white/10 dark:bg-slate-950 dark:text-white"/></label><button className="rounded-xl bg-indigo-600 px-3 py-2 text-sm font-semibold text-white">Search</button></form></div>
      {loading ? <div className="p-10 text-center text-sm text-slate-500">Loading accounts…</div> : !data?.users.length ? <div className="p-10 text-center text-sm text-slate-500">No matching accounts found.</div> : <div className="divide-y divide-slate-100 dark:divide-white/5">{data.users.map(user => <article key={user.id} className="flex flex-wrap items-center gap-3 p-4"><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{user.name}</p><p className="truncate text-xs text-slate-500 dark:text-slate-400">{user.email}</p><p className="mt-1 text-[11px] text-slate-400">{user.isSuperAdmin ? "SuperAdmin" : user.suspendedAt ? "Suspended" : "Active"}</p></div>{user.isSuperAdmin ? <span className="rounded-lg bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 dark:bg-indigo-400/10 dark:text-indigo-200">Protected account</span> : <button type="button" disabled={busyId === user.id} onClick={() => void moderate(user)} className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold disabled:opacity-50 ${user.suspendedAt ? "border-emerald-200 text-emerald-700 dark:border-emerald-400/20 dark:text-emerald-300" : "border-rose-200 text-rose-700 dark:border-rose-400/20 dark:text-rose-300"}`}>{user.suspendedAt ? <CheckCircle2 size={14}/> : <Ban size={14}/>} {user.suspendedAt ? "Restore account" : "Suspend account"}</button>}</article>)}</div>}
    </section>
    <div className="flex items-center justify-between rounded-b-2xl border border-t-0 border-slate-200 bg-white px-4 py-3 dark:border-white/10 dark:bg-slate-900"><p className="text-xs text-slate-500">Showing {data?.users.length ? offset + 1 : 0}–{Math.min(offset + (data?.users.length || 0), data?.pagination.total || 0)} of {data?.pagination.total || 0} matching accounts</p><div className="flex gap-2"><button type="button" disabled={loading || offset === 0} onClick={() => void load(query, Math.max(0, offset - 100))} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold disabled:opacity-40 dark:border-white/10">Previous</button><button type="button" disabled={loading || !data || offset + 100 >= data.pagination.total} onClick={() => void load(query, offset + 100)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold disabled:opacity-40 dark:border-white/10">Next</button></div></div>
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-white/10 dark:bg-slate-900">
      <div className="border-b border-slate-200 p-4 dark:border-white/10"><h2 className="font-semibold text-slate-900 dark:text-white">Recent administrative activity</h2><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Account moderation actions are recorded with actor and target metadata.</p></div>
      {auditLoading ? <p className="p-6 text-sm text-slate-500">Loading audit events…</p> : auditEvents.length ? <div className="divide-y divide-slate-100 dark:divide-white/5">{auditEvents.map((event, index) => <article key={event.timestamp + "-" + index} className="flex flex-wrap items-center gap-3 p-3"><div className="min-w-0 flex-1"><p className="text-sm font-medium text-slate-800 dark:text-slate-100">{event.action === "suspend" ? "Account suspended" : event.action === "restore" ? "Account restored" : event.action}</p><p className="mt-0.5 text-xs text-slate-500">{event.actorEmail} · Target: {event.targetUserId || "—"}</p></div><time className="text-[11px] text-slate-400" dateTime={new Date(event.timestamp).toISOString()}>{new Date(event.timestamp).toLocaleString()}</time></article>)}</div> : <p className="p-6 text-sm text-slate-500">No administrative actions have been recorded yet.</p>}
    </section>
    <section className="grid gap-4 xl:grid-cols-2">
      <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-white/10 dark:bg-slate-900">
        <div className="border-b border-slate-200 p-4 dark:border-white/10"><h2 className="font-semibold text-slate-900 dark:text-white">Platform communities</h2><p className="mt-1 text-xs text-slate-500">Open the community hub with system-wide moderation access.</p></div>
        <div className="divide-y divide-slate-100 dark:divide-white/5">{(data?.communities || []).map(community => <div key={community.id} className="flex items-center gap-3 p-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{community.name}</p><p className="text-[11px] text-slate-500">{community.groupCount} groups · {community.memberCount} members</p></div><Link href="/dashboard/communities" className="text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-300">Manage</Link></div>)}{!data?.communities?.length && <p className="p-5 text-xs text-slate-500">No communities are registered yet.</p>}</div>
      </article>
      <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-white/10 dark:bg-slate-900">
        <div className="border-b border-slate-200 p-4 dark:border-white/10"><h2 className="font-semibold text-slate-900 dark:text-white">Platform group chats</h2><p className="mt-1 text-xs text-slate-500">Open group conversations with system-wide moderation access.</p></div>
        <div className="divide-y divide-slate-100 dark:divide-white/5">{(data?.groups || []).map(group => <div key={group.id} className="flex items-center gap-3 p-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{group.name}</p><p className="text-[11px] text-slate-500">{group.memberCount} members</p></div><Link href={`/dashboard/chats/group--${group.id}`} className="text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-300">Open</Link></div>)}{!data?.groups?.length && <p className="p-5 text-xs text-slate-500">No group chats are registered yet.</p>}</div>
      </article>
    </section>
    <p className="flex items-center gap-2 text-xs text-slate-500"><Activity size={14}/> System-wide roles are configured through deployment secrets, not editable by normal users.</p>
  </main>
}
