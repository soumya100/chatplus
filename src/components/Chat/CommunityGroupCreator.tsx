"use client"

import { FormEvent, useState } from "react"
import axios from "axios"
import toast from "react-hot-toast"
import { Loader2, Plus, X } from "lucide-react"

type Member = { id: string; name: string }
type Props = { communityId: string; members: Member[]; onCreated: (group: Group) => void; onClose: () => void }

export default function CommunityGroupCreator({ communityId, members, onCreated, onClose }: Props) {
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [search, setSearch] = useState("")
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const toggle = (id: string, checked: boolean) => {
    setSelected(current => {
      if (!checked) return current.filter(value => value !== id)
      if (current.includes(id)) return current
      if (current.length >= 254) {
        toast.error("A group can contain up to 255 members, including its creator.")
        return current
      }
      return [...current, id]
    })
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || name.trim().length < 2) return
    setBusy(true)
    try {
      const response = await axios.post(`/api/community/${encodeURIComponent(communityId)}/groups`, {
        name: name.trim(), description: description.trim(), memberIds: selected,
      })
      toast.success("Group created inside this community")
      onCreated(response.data.group)
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Unable to create this group")
    } finally { setBusy(false) }
  }

  const visibleMembers = members.filter(member => member.name.toLowerCase().includes(search.toLowerCase()))

  return <form onSubmit={submit} className="space-y-3 rounded-xl border border-indigo-200 bg-indigo-50/50 p-3 dark:border-indigo-400/20 dark:bg-indigo-400/[0.05]">
    <div className="flex items-center justify-between gap-3"><h4 className="text-xs font-semibold text-slate-800 dark:text-slate-100">Create a group in this community</h4><button type="button" onClick={onClose} aria-label="Close create group form" className="rounded-lg p-1 text-slate-500 hover:bg-white dark:hover:bg-white/10"><X size={14}/></button></div>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200">Group name<input required minLength={2} maxLength={50} value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Design reviews" className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-indigo-400 dark:border-white/10 dark:bg-slate-950 dark:text-white"/></label>
      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200">Description (optional)<input maxLength={500} value={description} onChange={event => setDescription(event.target.value)} placeholder="What is this group for?" className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-indigo-400 dark:border-white/10 dark:bg-slate-950 dark:text-white"/></label>
    </div>
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-semibold text-slate-700 dark:text-slate-200">Add community members <span className="font-normal text-slate-400">({selected.length} selected)</span></p><input aria-label="Search community members for group" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search members" className="w-40 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-white/10 dark:bg-slate-950 dark:text-white"/></div>
      <div className="grid max-h-40 gap-1 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2 dark:border-white/10 dark:bg-slate-950 sm:grid-cols-2">
        {visibleMembers.map(member => <label key={member.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/5"><input type="checkbox" checked={selected.includes(member.id)} disabled={!selected.includes(member.id) && selected.length >= 254} onChange={event => toggle(member.id, event.target.checked)} className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"/><span className="truncate">{member.name}</span></label>)}
        {!visibleMembers.length && <p className="col-span-full p-3 text-center text-xs text-slate-400">No matching community members.</p>}
      </div>
    </div>
    <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 dark:border-white/10 dark:text-slate-300">Cancel</button><button type="submit" disabled={busy || name.trim().length < 2} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{busy ? <Loader2 size={13} className="animate-spin"/> : <Plus size={13}/>} Create group</button></div>
  </form>
}
