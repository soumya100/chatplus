"use client"

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react"
import axios from "axios"
import Link from "next/link"
import toast from "react-hot-toast"
import { Bell, Check, ChevronRight, CirclePlus, Crown, Layers3, LogOut, Megaphone, MoreHorizontal, Network, Plus, Search, Send, Settings2, Shield, ShieldCheck, Trash2, UserPlus, Users, X } from "lucide-react"

type CommunityMember = { id: string; name: string; image?: string }
type Announcement = { id: string; authorId: string; authorName: string; text: string; createdAt: number }
type Community = {
  id: string; name: string; description?: string; groupIds: string[]; ownerId: string;
  memberIds: string[]; members?: CommunityMember[]; adminIds?: string[];
  isAdmin?: boolean; isOwner?: boolean; isSuperAdmin?: boolean; isSuperAdmin?: boolean;
}
type Props = { groups: Group[]; sessionId: string }

export default function WhatsAppCommunities({ groups, sessionId }: Props) {
  const [communities, setCommunities] = useState<Community[]>([])
  const [invites, setInvites] = useState<Community[]>([])
  const [selectedId, setSelectedId] = useState("")
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [activeTab, setActiveTab] = useState<"announcements" | "groups" | "members">("announcements")
  const [loading, setLoading] = useState(true)
  const [announcementText, setAnnouncementText] = useState("")
  const [memberEmail, setMemberEmail] = useState("")
  const [groupToAdd, setGroupToAdd] = useState("")
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState("")
  const [newDescription, setNewDescription] = useState("")
  const [busy, setBusy] = useState(false)
  const [confirmAction, setConfirmAction] = useState<"leave" | "delete" | null>(null)
  const [query, setQuery] = useState("")

  const load = useCallback(async () => {
    try {
      const response = await axios.get("/api/community")
      const next = (response.data.communities || []) as Community[]
      setCommunities(next)
      setInvites(response.data.invites || [])
      setSelectedId(current => next.some(item => item.id === current) ? current : next[0]?.id || "")
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Unable to load communities")
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])
  const selected = communities.find(item => item.id === selectedId) || null

  const loadAnnouncements = useCallback(async (id: string) => {
    if (!id) { setAnnouncements([]); return }
    try {
      const response = await axios.get(`/api/community/${encodeURIComponent(id)}/announcements`)
      setAnnouncements(response.data.announcements || [])
    } catch (error: any) {
      setAnnouncements([])
      if (error?.response?.status !== 404) toast.error(error?.response?.data?.message || "Unable to load announcements")
    }
  }, [])

  useEffect(() => { void loadAnnouncements(selectedId) }, [selectedId, loadAnnouncements])

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    return term ? communities.filter(item => item.name.toLowerCase().includes(term) || (item.description || "").toLowerCase().includes(term)) : communities
  }, [communities, query])

  const mutate = async (community: Community, payload: Record<string, unknown>, success: string) => {
    if (busy) return false
    setBusy(true)
    try {
      await axios.post(`/api/community/${encodeURIComponent(community.id)}`, payload)
      await load()
      await loadAnnouncements(community.id)
      toast.success(success)
      return true
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Unable to update this community")
      return false
    } finally { setBusy(false) }
  }

  const create = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || newName.trim().length < 2) return
    setBusy(true)
    try {
      const response = await axios.post("/api/community", { name: newName.trim(), description: newDescription.trim(), groupIds: [] })
      setNewName(""); setNewDescription(""); setShowCreate(false)
      await load()
      setSelectedId(response.data.community.id)
      setActiveTab("announcements")
      toast.success("Community created. Add groups and invite members to get started.")
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Unable to create community")
    } finally { setBusy(false) }
  }

  const postAnnouncement = async (event: FormEvent) => {
    event.preventDefault()
    if (!selected || !announcementText.trim() || busy) return
    setBusy(true)
    try {
      await axios.post(`/api/community/${encodeURIComponent(selected.id)}/announcements`, { text: announcementText.trim() })
      setAnnouncementText("")
      await loadAnnouncements(selected.id)
      toast.success("Announcement posted")
    } catch (error: any) { toast.error(error?.response?.data?.message || "Unable to post announcement") }
    finally { setBusy(false) }
  }

  const invite = async (event: FormEvent) => {
    event.preventDefault()
    if (!selected || !memberEmail.trim()) return
    const saved = await mutate(selected, { action: "inviteMember", memberId: memberEmail.trim() }, "Invitation sent")
    if (saved) setMemberEmail("")
  }

  const addGroup = async () => {
    if (!selected || !groupToAdd) return
    const saved = await mutate(selected, { action: "addGroup", groupId: groupToAdd }, "Group added to community")
    if (saved) setGroupToAdd("")
  }

  const confirm = async () => {
    if (!selected || !confirmAction) return
    const action = confirmAction
    const saved = await mutate(selected, { action }, action === "delete" ? "Community deleted" : "You left the community")
    if (saved) { setConfirmAction(null); if (action === "delete" || action === "leave") setActiveTab("announcements") }
  }

  const linkedGroups = selected ? (selected.groupIds || []).map(id => groups.find(group => group.id === id)).filter(Boolean) as Group[] : []
  const manageableGroups = groups.filter(group =>
    !selected?.groupIds?.includes(group.id) && (selected?.isSuperAdmin || (group.adminIds || [group.creatorId]).includes(sessionId))
  )

  if (loading) return <div className="mx-auto flex min-h-[50vh] max-w-6xl items-center justify-center text-sm text-slate-500">Loading your communities…</div>

  return <main className="mx-auto max-w-7xl space-y-5 p-3 sm:p-6">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div><div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400"><Network size={15}/> Chat+ spaces</div><h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Communities</h1><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Keep related group chats together, with one shared announcements space.</p></div>
      <button type="button" onClick={() => setShowCreate(value => !value)} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"><CirclePlus size={16}/> Create community</button>
    </header>

    {showCreate && <form onSubmit={create} className="grid gap-3 rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4 dark:border-indigo-400/20 dark:bg-indigo-400/[0.06] sm:grid-cols-[1fr_1.5fr_auto] sm:items-end">
      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200">Community name<input required minLength={2} maxLength={60} value={newName} onChange={event => setNewName(event.target.value)} placeholder="e.g. Product team" className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-indigo-400 dark:border-white/10 dark:bg-slate-950 dark:text-white"/></label>
      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200">Description (optional)<input maxLength={500} value={newDescription} onChange={event => setNewDescription(event.target.value)} placeholder="What brings these groups together?" className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-indigo-400 dark:border-white/10 dark:bg-slate-950 dark:text-white"/></label>
      <div className="flex gap-2"><button disabled={busy || newName.trim().length < 2} className="rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-50">{busy ? "Creating…" : "Create"}</button><button type="button" onClick={() => setShowCreate(false)} className="rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-semibold text-slate-600 dark:border-white/10 dark:text-slate-300">Cancel</button></div>
    </form>}

    {invites.length > 0 && <section className="rounded-2xl border border-indigo-200 bg-indigo-50/70 p-4 dark:border-indigo-400/20 dark:bg-indigo-400/[0.06]"><div className="mb-3 flex items-center gap-2 text-sm font-semibold text-indigo-900 dark:text-indigo-100"><Bell size={16}/> Community invitations <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs dark:bg-indigo-400/20">{invites.length}</span></div><div className="flex flex-wrap gap-2">{invites.map(item => <div key={item.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-indigo-200 bg-white px-3 py-2 dark:border-white/10 dark:bg-slate-900"><span className="text-sm font-medium text-slate-800 dark:text-white">{item.name}</span><button type="button" disabled={busy} onClick={() => void mutate(item, {action:"acceptInvite"}, "You joined the community")} className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-semibold text-white"><Check size={12}/> Join</button><button type="button" disabled={busy} onClick={() => void mutate(item, {action:"declineInvite"}, "Invitation declined")} aria-label={`Decline ${item.name} invitation`} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10"><X size={14}/></button></div>)}</div></section>}

    <section className="grid min-h-[620px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-slate-900 lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="border-b border-slate-200 bg-slate-50/80 dark:border-white/10 dark:bg-slate-950/30 lg:border-b-0 lg:border-r">
        <div className="border-b border-slate-200 p-4 dark:border-white/10"><h2 className="text-sm font-semibold text-slate-900 dark:text-white">Your communities</h2><div className="relative mt-3"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search" aria-label="Search communities" className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-xs outline-none focus:border-indigo-400 dark:border-white/10 dark:bg-slate-900 dark:text-white"/></div></div>
        <div className="max-h-[300px] space-y-1 overflow-y-auto p-2 lg:max-h-[560px]">{filtered.map(item => <button type="button" key={item.id} onClick={() => {setSelectedId(item.id);setActiveTab("announcements")}} className={`flex w-full items-center gap-3 rounded-xl p-3 text-left transition ${selectedId === item.id ? "bg-emerald-50 ring-1 ring-emerald-200 dark:bg-emerald-400/10 dark:ring-emerald-400/20" : "hover:bg-white dark:hover:bg-white/[0.04]"}`}><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300"><Users size={18}/></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{item.name}</span><span className="mt-0.5 block text-[11px] text-slate-500">{item.groupIds?.length || 0} groups · {item.memberIds?.length || 0} members</span></span><ChevronRight size={15} className="text-slate-400"/></button>)}
          {!filtered.length && <div className="px-3 py-8 text-center text-xs text-slate-500">{communities.length ? "No communities match your search." : "You haven't joined a community yet."}</div>}
        </div>
      </aside>

      <div className="min-w-0">
        {!selected ? <div className="flex min-h-[500px] flex-col items-center justify-center p-8 text-center"><span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-400/10 dark:text-emerald-300"><Network size={25}/></span><h2 className="mt-4 text-lg font-semibold text-slate-900 dark:text-white">Your community space</h2><p className="mt-2 max-w-sm text-sm text-slate-500 dark:text-slate-400">Create a community to bring related group chats and their members together.</p><button type="button" onClick={() => setShowCreate(true)} className="mt-5 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white">Create your first community</button></div> : <>
          <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 p-4 sm:p-5 dark:border-white/10"><div className="flex min-w-0 items-center gap-3"><div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300"><Users size={22}/></div><div className="min-w-0"><h2 className="truncate text-lg font-bold text-slate-900 dark:text-white">{selected.name}</h2><p className="mt-0.5 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">{selected.description || "A shared space for related groups and announcements."}</p><p className="mt-1 text-[11px] text-slate-400">{selected.groupIds?.length || 0} groups · {selected.memberIds?.length || 0} members {selected.isAdmin ? "· Admin" : ""}</p></div></div><div className="flex items-center gap-1.5"><button type="button" onClick={() => setConfirmAction(selected.isOwner || selected.isSuperAdmin ? "delete" : "leave")} className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50 dark:border-white/10 dark:hover:bg-white/5" aria-label={selected.isOwner || selected.isSuperAdmin ? "Delete community" : "Leave community"}>{selected.isOwner || selected.isSuperAdmin ? <Trash2 size={15}/> : <LogOut size={15}/>}</button></div></header>
          <nav aria-label="Community sections" className="flex gap-1 overflow-x-auto border-b border-slate-200 px-3 dark:border-white/10">{([{id:"announcements",label:"Announcements",icon:Megaphone},{id:"groups",label:"Groups",icon:Layers3},{id:"members",label:"Members",icon:Users}] as const).map(tab => <button type="button" key={tab.id} onClick={() => setActiveTab(tab.id)} aria-current={activeTab===tab.id?"page":undefined} className={`inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-xs font-semibold ${activeTab===tab.id?"border-emerald-500 text-emerald-700 dark:text-emerald-300":"border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"}`}><tab.icon size={14}/>{tab.label}</button>)}</nav>

          <div className="p-4 sm:p-5">
            {activeTab === "announcements" && <section className="space-y-4"><div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-3 dark:border-emerald-400/15 dark:bg-emerald-400/[0.06]"><div className="flex items-center gap-2 text-xs font-semibold text-emerald-800 dark:text-emerald-200"><Megaphone size={14}/> Community announcements</div><p className="mt-1 text-xs leading-relaxed text-emerald-800/80 dark:text-emerald-100/70">Important updates from community admins appear here. Group conversations remain separate in their own chats.</p></div>
              {selected.isAdmin && <form onSubmit={postAnnouncement} className="rounded-xl border border-slate-200 p-3 dark:border-white/10"><label htmlFor="community-announcement" className="mb-2 block text-xs font-semibold text-slate-700 dark:text-slate-200">Post an announcement</label><textarea id="community-announcement" value={announcementText} onChange={event => setAnnouncementText(event.target.value)} maxLength={2000} rows={3} placeholder="Share an update with the community…" className="w-full resize-y rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm outline-none focus:border-emerald-400 dark:border-white/10 dark:bg-slate-950 dark:text-white"/><div className="mt-2 flex justify-end"><button type="submit" disabled={busy || !announcementText.trim()} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"><Send size={13}/> Publish</button></div></form>}
              {announcements.length ? <div className="space-y-3">{announcements.map(item => <article key={item.id} className="rounded-xl border border-slate-200 p-4 dark:border-white/10"><div className="flex items-center justify-between gap-3"><span className="text-xs font-semibold text-slate-800 dark:text-slate-100">{item.authorName}</span><time className="text-[10px] text-slate-400" dateTime={new Date(item.createdAt).toISOString()}>{new Date(item.createdAt).toLocaleString()}</time></div><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700 dark:text-slate-200">{item.text}</p></article>)}</div> : <div className="rounded-xl border border-dashed border-slate-200 px-4 py-10 text-center dark:border-white/10"><Megaphone size={23} className="mx-auto text-slate-400"/><p className="mt-2 text-sm font-semibold text-slate-700 dark:text-slate-200">No announcements yet</p><p className="mt-1 text-xs text-slate-500">Community admins can post updates here.</p></div>}
            </section>}

            {activeTab === "groups" && <section className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-sm font-semibold text-slate-900 dark:text-white">Groups in this community</h3><p className="mt-1 text-xs text-slate-500">Open a group to continue its own conversation.</p></div>{selected.isAdmin && manageableGroups.length > 0 && <div className="flex gap-2"><select aria-label="Choose a group to add" value={groupToAdd} onChange={event => setGroupToAdd(event.target.value)} className="max-w-[190px] rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs dark:border-white/10 dark:bg-slate-950 dark:text-white"><option value="">Add an existing group</option>{manageableGroups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select><button type="button" onClick={() => void addGroup()} disabled={busy || !groupToAdd} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"><Plus size={13}/></button></div>}</div>
              {linkedGroups.length ? <div className="grid gap-3 sm:grid-cols-2">{linkedGroups.map(group => <article key={group.id} className="rounded-xl border border-slate-200 p-4 dark:border-white/10"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-400/10 dark:text-indigo-300"><Users size={18}/></span><div className="min-w-0 flex-1"><h4 className="truncate text-sm font-semibold text-slate-900 dark:text-white">{group.name}</h4><p className="text-[11px] text-slate-500">{group.memberIds?.length || 0} group members</p></div></div><div className="mt-3 flex items-center justify-between"><Link href={`/dashboard/chats/group--${group.id}`} className="text-xs font-semibold text-indigo-600 hover:text-indigo-500 dark:text-indigo-300">Open group chat →</Link>{selected.isAdmin && <button type="button" disabled={busy} onClick={() => void mutate(selected,{action:"removeGroup",groupId:group.id},"Group removed from community")} className="text-[11px] font-medium text-rose-600 hover:underline dark:text-rose-300">Unlink</button>}</div></article>)}</div> : <div className="rounded-xl border border-dashed border-slate-200 p-9 text-center dark:border-white/10"><Layers3 size={22} className="mx-auto text-slate-400"/><p className="mt-2 text-sm font-semibold text-slate-700 dark:text-slate-200">No groups linked</p><p className="mt-1 text-xs text-slate-500">Community admins can add group chats they administer.</p></div>}</section>}

            {activeTab === "members" && <section className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-sm font-semibold text-slate-900 dark:text-white">Community members</h3><p className="mt-1 text-xs text-slate-500">Manage who belongs to this community.</p></div><span className="text-xs text-slate-400">{selected.memberIds?.length || 0} total</span></div>
              {selected.isAdmin && <form onSubmit={invite} className="flex gap-2"><label className="min-w-0 flex-1"><span className="sr-only">Invite member by email</span><input type="email" required value={memberEmail} onChange={event => setMemberEmail(event.target.value)} placeholder="Invite by email address" className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs outline-none focus:border-indigo-400 dark:border-white/10 dark:bg-slate-950 dark:text-white"/></label><button type="submit" disabled={busy || !memberEmail.trim()} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-3 py-2.5 text-xs font-semibold text-white disabled:opacity-50"><UserPlus size={14}/> Invite</button></form>}
              <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-white/5 dark:border-white/10">{(selected.members || []).map(member => {const admin = (selected.adminIds || [selected.ownerId]).includes(member.id);return <div key={member.id} className="flex flex-wrap items-center gap-3 p-3"><div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600 dark:bg-white/10 dark:text-slate-200">{member.name.slice(0,1).toUpperCase()}</div><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-slate-800 dark:text-slate-100">{member.name}</p><p className="text-[10px] text-slate-400">{member.id === selected.ownerId ? "Community owner" : admin ? "Community admin" : "Member"}</p></div>{selected.isOwner && member.id !== selected.ownerId && <div className="flex gap-1.5">{admin ? <button type="button" disabled={busy} onClick={() => void mutate(selected,{action:"demoteAdmin",memberId:member.id},"Admin role removed")} className="rounded-lg border border-slate-200 px-2 py-1.5 text-[10px] font-semibold text-slate-600 dark:border-white/10 dark:text-slate-300">Remove admin</button> : <button type="button" disabled={busy} onClick={() => void mutate(selected,{action:"promoteAdmin",memberId:member.id},"Member promoted to admin")} className="rounded-lg border border-indigo-200 px-2 py-1.5 text-[10px] font-semibold text-indigo-700 dark:border-indigo-400/20 dark:text-indigo-300"><Shield size={12} className="inline mr-1"/>Make admin</button>}<button type="button" disabled={busy} onClick={() => void mutate(selected,{action:"removeMember",memberId:member.id},"Member removed")} aria-label={`Remove ${member.name}`} className="rounded-lg p-1.5 text-rose-600 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-400/10"><X size={14}/></button></div>}</div>})}</div>
              {selected.isOwner && <p className="text-[11px] text-slate-500">Only the community owner can promote or demote admins. Admins can invite members and post announcements.</p>}
            </section>}
          </div>
        </>}
      </div>
    </section>

    {confirmAction && selected && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"><section role="dialog" aria-modal="true" aria-labelledby="community-action-title" className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-white/10 dark:bg-slate-900"><h2 id="community-action-title" className="text-base font-semibold text-slate-900 dark:text-white">{confirmAction === "delete" ? "Delete this community?" : "Leave this community?"}</h2><p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{confirmAction === "delete" ? "The community and its announcements will be removed. Linked group chats and their message history will remain." : "You will leave this community. Your membership in its separate group chats will not be changed."}</p><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setConfirmAction(null)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 dark:border-white/10 dark:text-slate-300">Cancel</button><button type="button" disabled={busy} onClick={() => void confirm()} className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{confirmAction === "delete" ? "Delete community" : "Leave community"}</button></div></section></div>}
  </main>
}
