"use client"

import { ClipboardEvent, FormEvent, Fragment, useEffect, useRef, useState } from "react"
import { Menu, Popover, Transition } from "@headlessui/react"
import TextareaAutosize from "react-textarea-autosize"
import Skeleton from "react-loading-skeleton"
import Image from "next/image"
import { Check, CheckCircle2, ChevronDown, Code2, Copy, Download, FileText, Globe2, Image as ImageIcon, Loader2, MoreHorizontal, Paperclip, Pencil, Send, Sparkles, StopCircle, ThumbsDown, ThumbsUp, Trash2, User, Wand2, X } from "lucide-react"
import { AIAttachment, AI_ATTACHMENT_MAX_FILES, AI_ATTACHMENT_MAX_FILE_SIZE, AI_ATTACHMENT_MAX_TOTAL_SIZE, classifyAIAttachment, sanitizeAIFilename, uploadAIAttachment } from "@/lib/ai/attachments"
import MarkdownMessage from "./MarkdownMessage"

type SearchSource = { title: string; url: string; snippet: string; publishedDate?: string }
type ChatMessage = { role: "user" | "assistant"; content: string; sources?: SearchSource[]; imageData?: string; imagePending?: boolean; imagePrompt?: string; attachments?: AIAttachment[]; createdAt?: string }
type PendingAttachment = AIAttachment & { status: "uploading" | "uploaded" | "error"; progress: number; previewUrl?: string; sourceFile?: File; error?: string }
type Model = "lightning" | "super"
type AssistantMode = "general" | "coding"

export default function AIChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [model, setModel] = useState<Model>("super")
  const [mode, setMode] = useState<AssistantMode>("coding")
  const [webSearch, setWebSearch] = useState(false)
  const [imageMode, setImageMode] = useState(false)
  const [busy, setBusy] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState("")
  const [lastImagePrompt, setLastImagePrompt] = useState("")
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const [dragActive, setDragActive] = useState(false)
  const [restoring, setRestoring] = useState(true)
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)
  const [feedback, setFeedback] = useState<Record<number, "up" | "down">>({})
  const abortRef = useRef<AbortController | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const shouldAutoScrollRef = useRef(true)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let active = true
    const restore = async () => {
      try {
        const response = await fetch("/api/ai/conversations", { cache: "no-store" })
        if (response.ok) {
          const payload = await response.json()
          if (active && Array.isArray(payload?.messages) && payload.messages.length) {
            setMessages(payload.messages)
            return
          }
        }
        const imageResponse = await fetch("/api/ai/images", { cache: "no-store" })
        if (!imageResponse.ok) return
        const payload = await imageResponse.json()
        if (!active || !Array.isArray(payload?.images)) return
        const restored: ChatMessage[] = payload.images.slice().reverse().flatMap((item: { prompt?: string; imageUrl?: string }) => {
          if (typeof item.prompt !== "string" || typeof item.imageUrl !== "string") return []
          return [
            { role: "user" as const, content: "Create an image: " + item.prompt },
            { role: "assistant" as const, content: "", imageData: item.imageUrl, imagePrompt: item.prompt },
          ]
        })
        if (restored.length) setMessages(restored)
      } catch {
        // Conversation restore is best-effort and never blocks a new chat.
      } finally {
        if (active) setRestoring(false)
      }
    }
    void restore()
    return () => { active = false }
  }, [])

  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return
    if (shouldAutoScrollRef.current) {
      container.scrollTo({ top: container.scrollHeight, behavior: "smooth" })
      setShowScrollToBottom(false)
    } else if (messages.length) {
      setShowScrollToBottom(true)
    }
  }, [messages])

  async function persistConversation(nextMessages: ChatMessage[]) {
    try {
      const response = await fetch("/api/ai/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages.slice(-60).map(message => ({
          role: message.role,
          content: message.content,
          ...(message.createdAt ? { createdAt: message.createdAt } : {}),
          ...(message.attachments?.length ? { attachments: message.attachments } : {}),
          ...(message.sources?.length ? { sources: message.sources } : {}),
          ...(message.imageData ? { imageData: message.imageData } : {}),
          ...(message.imagePrompt ? { imagePrompt: message.imagePrompt } : {}),
        })) }),
      })
      if (!response.ok) throw new Error("Conversation history save failed")
    } catch {
      setError("Your response is ready, but conversation history could not be saved.")
    }
  }

  async function addFiles(fileList: FileList | File[]) {
    setError("")
    const selected = Array.from(fileList)
    if (!selected.length) return
    const remainingSlots = AI_ATTACHMENT_MAX_FILES - attachments.length
    if (remainingSlots <= 0) {
      setError("You can attach up to 5 files per message.")
      return
    }
    const existingBytes = attachments.reduce((total, item) => total + item.fileSize, 0)
    let acceptedBytes = existingBytes
    const pending = selected.slice(0, remainingSlots).flatMap(file => {
      if (!file.size || file.size > AI_ATTACHMENT_MAX_FILE_SIZE || acceptedBytes + file.size > AI_ATTACHMENT_MAX_TOTAL_SIZE) {
        setError("Each file must be 15 MiB or smaller and the combined message limit is 30 MiB.")
        return []
      }
      acceptedBytes += file.size
      const fileName = sanitizeAIFilename(file.name)
      const mimeType = (file.type || "").split(";")[0].trim().toLowerCase()
      const kind = classifyAIAttachment(mimeType, fileName)
      return [{
        id: crypto.randomUUID(),
        url: "",
        fileName,
        fileSize: file.size,
        mimeType: mimeType || "application/octet-stream",
        kind,
        status: "uploading" as const,
        progress: 0,
        ...(kind === "image" ? { previewUrl: URL.createObjectURL(file) } : {}),
        sourceFile: file,
      }]
    })
    if (selected.length > remainingSlots) setError("Only the first 5 attachments can be added to one message.")
    if (!pending.length) return
    setAttachments(current => [...current, ...pending])

    for (const item of pending) {
      try {
        const uploaded = await uploadAIAttachment(item.sourceFile as File, percentage => {
          setAttachments(current => current.map(candidate => candidate.id === item.id ? { ...candidate, progress: percentage } : candidate))
        })
        setAttachments(current => current.map(candidate => candidate.id === item.id
          ? { ...uploaded, id: item.id, status: "uploaded", progress: 100, previewUrl: candidate.previewUrl }
          : candidate))
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "Upload failed. Please retry."
        setAttachments(current => current.map(candidate => candidate.id === item.id
          ? { ...candidate, status: "error", error: message }
          : candidate))
        setError(message)
      }
    }
  }

  async function retryAttachment(id: string) {
    const item = attachments.find(candidate => candidate.id === id)
    if (!item?.sourceFile) return
    setAttachments(current => current.map(candidate => candidate.id === id ? { ...candidate, status: "uploading", progress: 0, error: undefined } : candidate))
    try {
      const uploaded = await uploadAIAttachment(item.sourceFile, percentage => {
        setAttachments(current => current.map(candidate => candidate.id === id ? { ...candidate, progress: percentage } : candidate))
      })
      setAttachments(current => current.map(candidate => candidate.id === id
        ? { ...uploaded, id, status: "uploaded", progress: 100, previewUrl: candidate.previewUrl }
        : candidate))
      setError("")
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Upload failed. Please retry."
      setAttachments(current => current.map(candidate => candidate.id === id ? { ...candidate, status: "error", error: message } : candidate))
      setError(message)
    }
  }

  function removeAttachment(id: string) {
    const item = attachments.find(candidate => candidate.id === id)
    if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl)
    setAttachments(current => current.filter(candidate => candidate.id !== id))
  }

  function clearAttachments() {
    attachments.forEach(item => { if (item.previewUrl) URL.revokeObjectURL(item.previewUrl) })
    setAttachments([])
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.items)
      .filter(item => item.kind === "file" && item.type.startsWith("image/"))
      .map(item => item.getAsFile())
      .filter((file): file is File => Boolean(file))
    if (files.length) {
      event.preventDefault()
      void addFiles(files)
    }
  }

  async function sendMessage(
    prompt: string,
    baseMessages: ChatMessage[] = messages,
    uploadedAttachments: AIAttachment[] = [],
    clearComposer = true,
  ) {
    if (busy) return
    const createdAt = new Date().toISOString()
    const nextMessages: ChatMessage[] = [...baseMessages, {
      role: "user",
      content: prompt,
      createdAt,
      ...(uploadedAttachments.length ? { attachments: uploadedAttachments } : {}),
    }]
    setMessages([...nextMessages, { role: "assistant", content: "", createdAt }])
    if (clearComposer) setInput("")
    setError("")
    setBusy(true)
    const controller = new AbortController()
    abortRef.current = controller

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          mode,
          webSearch,
          messages: nextMessages.slice(-20).map(({ role, content, attachments: messageAttachments }) => ({
            role,
            content,
            ...(messageAttachments?.length ? { attachments: messageAttachments } : {}),
          })),
        }),
        signal: controller.signal,
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload.message || "Unable to get an AI response")
      }
      if (!response.body) throw new Error("The AI response stream was empty")
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      let answer = ""
      let sources: SearchSource[] = []
      const processEvent = (eventText: string) => {
        for (const line of eventText.split("\n")) {
          if (!line.startsWith("data:")) continue
          const data = line.slice(5).trim()
          if (!data || data === "[DONE]") continue
          try {
            const chunk = JSON.parse(data)
            if (chunk.type === "sources" && Array.isArray(chunk.sources)) {
              sources = chunk.sources
              setMessages([...nextMessages, { role: "assistant", content: answer, sources, createdAt }])
              continue
            }
            answer += chunk.choices?.[0]?.delta?.content || ""
            setMessages([...nextMessages, { role: "assistant", content: answer, sources, createdAt }])
          } catch {
            // Ignore keep-alives and non-JSON event lines.
          }
        }
      }
      while (true) {
        const result = await reader.read()
        if (result.done) break
        buffer += decoder.decode(result.value, { stream: true })
        const events = buffer.split("\n\n")
        buffer = events.pop() || ""
        for (const eventText of events) processEvent(eventText)
      }
      buffer += decoder.decode()
      if (buffer.trim()) processEvent(buffer)
      if (!answer.trim()) throw new Error("The model returned an empty response. Please try again.")

      const finalMessages: ChatMessage[] = [...nextMessages, { role: "assistant", content: answer, sources, createdAt: new Date().toISOString() }]
      setMessages(finalMessages)
      await persistConversation(finalMessages)
      if (clearComposer) clearAttachments()
    } catch (cause) {
      if (!controller.signal.aborted) {
        setMessages(baseMessages)
        if (clearComposer) setInput(prompt)
        setError(cause instanceof Error ? cause.message : "Something went wrong")
      }
    } finally {
      setBusy(false)
      abortRef.current = null
      if (shouldAutoScrollRef.current) {
        const container = scrollContainerRef.current
        if (container) container.scrollTo({ top: container.scrollHeight, behavior: "smooth" })
      }
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const prompt = input.trim()
    const uploadedAttachments: AIAttachment[] = attachments
      .filter(item => item.status === "uploaded")
      .map(({ id, url, fileName, fileSize, mimeType, kind }) => ({ id, url, fileName, fileSize, mimeType, kind }))
    if (busy || attachments.some(item => item.status !== "uploaded")) return
    if (!prompt && !uploadedAttachments.length) return
    if (imageMode) {
      if (uploadedAttachments.length) {
        setError("Remove file attachments before switching to image generation.")
        return
      }
      await generateImage(prompt)
      return
    }
    await sendMessage(prompt, messages, uploadedAttachments, true)
  }

  function handleScroll() {
    const container = scrollContainerRef.current
    if (!container) return
    const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100
    shouldAutoScrollRef.current = atBottom
    setShowScrollToBottom(!atBottom)
  }

  function scrollToBottom() {
    shouldAutoScrollRef.current = true
    setShowScrollToBottom(false)
    const container = scrollContainerRef.current
    if (container) container.scrollTo({ top: container.scrollHeight, behavior: "smooth" })
  }

  function stopGenerating() {
    abortRef.current?.abort()
    setBusy(false)
    setError("Generation stopped.")
    const snapshot = messages.filter(message => message.content.trim() || message.attachments?.length || message.imageData)
    if (snapshot.length) void persistConversation(snapshot)
  }

  async function downloadImage(url: string) {
    try {
      const response = await fetch(url, { cache: "no-store" })
      if (!response.ok) throw new Error("Image download failed")
      const blob = await response.blob()
      const objectUrl = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = objectUrl
      anchor.download = "chatplus-generated-image.jpg"
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1200)
    } catch {
      setError("Unable to download this image. Use Open full size to save it from your browser.")
    }
  }

  async function copyMessage(text: string) {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      setError("Unable to copy this message. Check clipboard permissions.")
    }
  }

  function toggleFeedback(index: number, value: "up" | "down") {
    setFeedback(current => {
      const next = { ...current }
      if (next[index] === value) delete next[index]
      else next[index] = value
      return next
    })
  }

  function editMessage(index: number) {
    const message = messages[index]
    if (!message || message.role !== "user") return
    clearAttachments()
    if (message.attachments?.length) {
      setAttachments(message.attachments.map(attachment => ({ ...attachment, status: "uploaded", progress: 100 })))
    }
    setInput(message.content)
    setMessages(messages.slice(0, index))
    setFeedback({})
  }

  async function regenerateResponse(index: number) {
    if (busy) return
    if (attachments.length) {
      setError("Send or remove the current composer attachments before regenerating a previous response.")
      return
    }
    let userIndex = index - 1
    while (userIndex >= 0 && messages[userIndex].role !== "user") userIndex--
    if (userIndex < 0) return
    const userMessage = messages[userIndex]
    const history = messages.slice(0, userIndex)
    setMessages(history)
    setFeedback({})
    await sendMessage(userMessage.content, history, userMessage.attachments || [], true)
  }

  async function generateImage(prompt: string, appendUserMessage = true) {
    const createdAt = new Date().toISOString()
    const nextMessages: ChatMessage[] = appendUserMessage
      ? [...messages, { role: "user", content: "Create an image: " + prompt, createdAt }]
      : messages
    setMessages([...nextMessages, { role: "assistant", content: "", imagePending: true, createdAt }])
    setInput("")
    setError("")
    setLastImagePrompt(prompt)
    setBusy(true)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const response = await fetch("/api/ai/images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
        signal: controller.signal,
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.message || "Unable to generate image")
      if (typeof payload.image !== "string" || !/^https:\/\//.test(payload.image)) {
        throw new Error("The image provider returned an invalid image URL")
      }
      const finalMessages: ChatMessage[] = [...nextMessages, { role: "assistant", content: "", imageData: payload.image, imagePrompt: prompt, createdAt: new Date().toISOString() }]
      setMessages(finalMessages)
      await persistConversation(finalMessages)
      setLastImagePrompt("")
    } catch (cause) {
      setMessages(nextMessages)
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : "Image generation failed")
      }
    } finally {
      setBusy(false)
      abortRef.current = null
      if (shouldAutoScrollRef.current) {
        const container = scrollContainerRef.current
        if (container) container.scrollTo({ top: container.scrollHeight, behavior: "smooth" })
      }
    }
  }

  async function exportPdf() {
    if (!messages.length || exporting || busy) return
    setExporting(true)
    setError("")
    try {
      const response = await fetch("/api/ai/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: messages.map(message => ({
            role: message.role,
            content: (message.content || (message.imageData ? "[Generated image attached]" : "")) + (message.attachments?.length ? "\n\nAttachments: " + message.attachments.map(item => item.fileName).join(", ") : ""),
            ...(message.sources?.length ? { sources: message.sources } : {}),
            ...(message.imageData ? { imageData: message.imageData } : {}),
          })),
        }),
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload.message || "Unable to export this conversation")
      }
      if (!response.headers.get("content-type")?.includes("application/pdf")) {
        throw new Error("The export service returned an unexpected file format")
      }
      const blob = await response.blob()
      const objectUrl = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = objectUrl
      anchor.download = "chatplus-conversation.pdf"
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "PDF export failed")
    } finally {
      setExporting(false)
    }
  }

  function clearChat() {
    abortRef.current?.abort()
    setMessages([])
    clearAttachments()
    setInput("")
    setFeedback({})
    setShowScrollToBottom(false)
    setError("")
    setLastImagePrompt("")
    setBusy(false)
    void fetch("/api/ai/conversations", { method: "DELETE" })
    void fetch("/api/ai/images", { method: "DELETE" })
  }

  return (
    <main className="mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col px-4 py-5 sm:px-6">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3 px-1">
        <div className="flex min-w-0 items-center gap-3">
          <div className="relative shrink-0">
            <div className="rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 p-3 text-white shadow-lg shadow-indigo-600/20"><Sparkles size={21}/></div>
            <span className="absolute -bottom-1 -right-1 h-3 w-3 rounded-full border-2 border-white bg-emerald-500 dark:border-zinc-950"/>
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-bold tracking-tight text-slate-900 dark:text-white">{mode === "coding" ? "ChatPlus Code" : "ChatPlus AI"}</h1>
            <p className="truncate text-xs text-slate-500 dark:text-slate-400">{imageMode ? "Image creation · NVIDIA FLUX.1-schnell" : "Powered by NVIDIA Nemotron"}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!imageMode && <Popover className="relative">
            <Popover.Button disabled={busy} className="inline-flex max-w-[min(16rem,48vw)] items-center gap-2 rounded-xl border border-slate-200 bg-white/80 px-3 py-2 text-left text-xs font-semibold text-slate-700 shadow-sm backdrop-blur transition hover:border-indigo-300 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50 dark:border-white/10 dark:bg-zinc-900/80 dark:text-slate-200 dark:hover:border-indigo-400/40 dark:hover:bg-zinc-900">
              <span className="min-w-0 truncate">{model === "lightning" ? "Nemotron 3.5 Lightning" : "Nemotron 3.5 Super VL"}</span>
              <ChevronDown size={14} className="shrink-0 text-slate-400"/>
            </Popover.Button>
            <Transition as={Fragment} enter="transition ease-out duration-150" enterFrom="opacity-0 translate-y-1 scale-95" enterTo="opacity-100 translate-y-0 scale-100" leave="transition ease-in duration-100" leaveFrom="opacity-100 translate-y-0 scale-100" leaveTo="opacity-0 translate-y-1 scale-95">
              <Popover.Panel className="absolute right-0 z-40 mt-2 w-[min(21rem,calc(100vw-2rem))] origin-top-right rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl shadow-slate-900/10 dark:border-white/10 dark:bg-zinc-900 dark:shadow-black/40">
                {({ close }) => <div>
                  <div className="px-3 pb-2 pt-1">
                    <p className="text-xs font-semibold text-slate-900 dark:text-white">Choose a model</p>
                    <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">Switch between speed and advanced multimodal reasoning</p>
                  </div>
                  <button type="button" onClick={() => { setModel("lightning"); close() }} aria-pressed={model === "lightning"} className={"flex w-full items-start gap-3 rounded-xl p-3 text-left transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:bg-white/5 " + (model === "lightning" ? "bg-indigo-50/80 dark:bg-indigo-400/10" : "")}>
                    <span className="mt-0.5 rounded-lg bg-sky-500/10 p-2 text-sky-600 dark:text-sky-300"><Sparkles size={16}/></span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-white">Nemotron 3.5 Lightning {model === "lightning" && <Check size={13} className="text-indigo-500"/>}</span>
                      <span className="mt-1 block text-[11px] leading-5 text-slate-500 dark:text-slate-400">Fast responses for everyday questions, coding help, and quick iterations</span>
                      <span className="mt-1 block text-[10px] font-medium text-sky-600 dark:text-sky-300">Fast · Text</span>
                    </span>
                  </button>
                  <button type="button" onClick={() => { setModel("super"); close() }} aria-pressed={model === "super"} className={"flex w-full items-start gap-3 rounded-xl p-3 text-left transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:bg-white/5 " + (model === "super" ? "bg-indigo-50/80 dark:bg-indigo-400/10" : "")}>
                    <span className="mt-0.5 rounded-lg bg-violet-500/10 p-2 text-violet-600 dark:text-violet-300"><Code2 size={16}/></span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-white">Nemotron 3.5 Super VL {model === "super" && <Check size={13} className="text-indigo-500"/>}</span>
                      <span className="mt-1 block text-[11px] leading-5 text-slate-500 dark:text-slate-400">Advanced reasoning for complex code, document analysis, and image understanding</span>
                      <span className="mt-1 block text-[10px] font-medium text-violet-600 dark:text-violet-300">Advanced · Vision</span>
                    </span>
                  </button>
                </div>}
              </Popover.Panel>
            </Transition>
          </Popover>}
          <Menu as="div" className="relative">
            <Menu.Button type="button" aria-label="More chat actions" title="More actions" className="rounded-xl border border-slate-200 bg-white/80 p-2.5 text-slate-500 shadow-sm backdrop-blur transition hover:border-indigo-300 hover:bg-white hover:text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-white/10 dark:bg-zinc-900/80 dark:text-slate-300 dark:hover:bg-zinc-900 dark:hover:text-indigo-300">
              <MoreHorizontal size={18}/>
            </Menu.Button>
            <Transition as={Fragment} enter="transition ease-out duration-150" enterFrom="opacity-0 translate-y-1 scale-95" enterTo="opacity-100 translate-y-0 scale-100" leave="transition ease-in duration-100" leaveFrom="opacity-100 translate-y-0 scale-100" leaveTo="opacity-0 translate-y-1 scale-95">
              <Menu.Items className="absolute right-0 z-40 mt-2 w-48 origin-top-right rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-white/10 dark:bg-zinc-900">
                <Menu.Item disabled={!messages.length || busy || exporting}>
                  {({ active, disabled }) => <button type="button" onClick={() => void exportPdf()} disabled={disabled} className={"flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-xs font-medium disabled:opacity-40 " + (active ? "bg-slate-100 dark:bg-white/5" : "text-slate-700 dark:text-slate-200")}><FileText size={15}/>{exporting ? "Exporting PDF…" : "Export PDF"}</button>}
                </Menu.Item>
                <Menu.Item disabled={!messages.length && !busy}>
                  {({ active, disabled }) => <button type="button" onClick={clearChat} disabled={disabled} className={"flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-xs font-medium text-rose-600 disabled:opacity-40 dark:text-rose-300 " + (active ? "bg-rose-50 dark:bg-rose-400/10" : "")}><Trash2 size={15}/>Clear chat</button>}
                </Menu.Item>
              </Menu.Items>
            </Transition>
          </Menu>
        </div>
      </header>
      <section
        onDragOver={event => { event.preventDefault(); setDragActive(true) }}
        onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragActive(false) }}
        onDrop={event => { event.preventDefault(); setDragActive(false); void addFiles(event.dataTransfer.files) }}
        className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white/90 shadow-xl shadow-slate-900/[0.03] backdrop-blur-xl dark:border-white/10 dark:bg-zinc-900/90 dark:shadow-black/20"
      >
        {dragActive && <div className="pointer-events-none absolute inset-3 z-30 flex items-center justify-center rounded-2xl border-2 border-dashed border-indigo-400 bg-indigo-500/10 text-sm font-semibold text-indigo-600 backdrop-blur-sm dark:text-indigo-300">Drop files to attach</div>}
        <div ref={scrollContainerRef} onScroll={handleScroll} className="ai-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
          {!messages.length && <div className="ai-hero-glow mx-auto flex min-h-full max-w-2xl flex-col items-center justify-center py-8 text-center">
            {restoring ? <div className="w-full max-w-lg space-y-3 px-6"><Skeleton height={24} width="55%" className="mx-auto"/><Skeleton height={14} count={2}/><Skeleton height={74} count={3} borderRadius={16}/></div> : <>
              <div className="mb-5 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 p-4 text-white shadow-xl shadow-indigo-600/20"><Sparkles size={28}/></div>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.22em] text-indigo-600 dark:text-indigo-300">Your AI workspace</p>
              <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-3xl">{imageMode ? "What would you like to create?" : mode === "coding" ? "Let's build something great." : "What can I help you with?"}</h2>
              <p className="mt-3 max-w-lg text-sm leading-6 text-slate-500 dark:text-slate-400">{imageMode ? "Describe your idea and turn it into an image with NVIDIA FLUX." : "Think, write, code, analyze documents, or explore ideas with your AI assistant."}</p>
              <div className="mt-8 grid w-full gap-3 text-left sm:grid-cols-2">
                {[
                  { title: "Debug my code", description: "Find bugs and explain the fix", prompt: "Help me debug this code. Explain the root cause and show a corrected version.", icon: <Code2 size={17}/>, coding: true },
                  { title: "Summarize a PDF", description: "Extract key points and actions", prompt: "Summarize the attached PDF into key points, decisions, and action items.", icon: <FileText size={17}/> },
                  { title: "Analyze a CSV", description: "Explore trends and anomalies", prompt: "Analyze the attached CSV. Summarize its columns, trends, outliers, and useful insights.", icon: <Globe2 size={17}/> },
                  { title: "Generate an image", description: "Create a visual from a prompt", prompt: "A cinematic editorial illustration of a futuristic creative workspace at blue hour, atmospheric lighting, refined composition.", icon: <ImageIcon size={17}/>, image: true },
                  { title: "Explain a concept", description: "Learn with clear examples", prompt: "Explain a complex technical concept step by step with a simple analogy and practical examples.", icon: <Sparkles size={17}/> },
                  { title: "Review my code", description: "Quality, security, and performance", prompt: "Review my code for correctness, security, performance, accessibility, and maintainability. Prioritize actionable findings.", icon: <CheckCircle2 size={17}/>, coding: true },
                ].map(item => <button key={item.title} type="button" onClick={() => { setInput(item.prompt); if (item.image) { setImageMode(true); setWebSearch(false) } else if (item.coding) { setMode("coding"); setImageMode(false) } }} className="group flex items-start gap-3 rounded-2xl border border-slate-200/80 bg-white/75 p-4 text-left shadow-sm transition duration-150 hover:-translate-y-0.5 hover:border-indigo-300 hover:bg-indigo-50/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-white/10 dark:bg-zinc-900/70 dark:hover:border-indigo-400/40 dark:hover:bg-indigo-400/5">
                    <span className="rounded-xl bg-indigo-500/10 p-2.5 text-indigo-600 transition group-hover:bg-indigo-500 group-hover:text-white dark:text-indigo-300">{item.icon}</span>
                    <span className="min-w-0"><span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">{item.title}</span><span className="mt-1 block text-xs leading-5 text-slate-500 dark:text-slate-400">{item.description}</span></span>
                  </button>)}
              </div>
            </>}
          </div>}
          <div role="log" aria-label="Conversation messages" aria-live="polite" aria-relevant="additions text" className="mx-auto w-full max-w-3xl space-y-8">
            {messages.map((message, index) => <div key={index} className="ai-message-enter group flex gap-3">
              {message.role === "assistant" && <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-md shadow-indigo-600/15"><Sparkles size={15}/></div>}
              <div className={"flex min-w-0 flex-col gap-2 " + (message.role === "user" ? "ml-auto max-w-[90%] items-end" : "w-full max-w-full")}>
                <div className="flex items-center gap-2 px-1">
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">{message.role === "user" ? "You" : "ChatPlus AI"}</span>
                  {message.createdAt && <time className="text-[10px] text-slate-400">{new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>}
                  {message.role === "assistant" && message.sources?.length ? <span className="rounded-full bg-indigo-500/10 px-2 py-0.5 text-[9px] font-semibold text-indigo-600 dark:text-indigo-300">Web sources</span> : null}
                </div>
                {message.content && (message.role === "assistant"
                  ? <div aria-live="polite" className="w-full"><MarkdownMessage content={message.content}/></div>
                  : <div className="max-w-full whitespace-pre-wrap break-words rounded-2xl rounded-tr-md border border-indigo-300/20 bg-gradient-to-br from-indigo-600 to-violet-600 px-4 py-3 text-sm leading-6 text-white shadow-lg shadow-indigo-600/10">{message.content}</div>)}
                {!message.content && busy && index === messages.length - 1 && message.role === "assistant" && <div role="status" aria-label="ChatPlus is thinking" className="inline-flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-xs text-slate-500 dark:bg-zinc-800 dark:text-slate-300"><span className="flex gap-1"><i className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-500"/><i className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-500 [animation-delay:120ms]"/><i className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-500 [animation-delay:240ms]"/></span> Thinking…</div>}
                {message.attachments?.length ? <div className={"flex w-full flex-wrap gap-2 " + (message.role === "user" ? "justify-end" : "")}>
                  {message.attachments.map(attachment => <div key={attachment.id} className="max-w-[260px]">
                    {attachment.kind === "image"
                      ? <a href={attachment.url} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-xl border border-slate-200 shadow-sm dark:border-white/10"><Image src={attachment.url} alt={attachment.fileName} width={180} height={140} unoptimized className="h-28 w-36 object-cover"/></a>
                      : <a href={attachment.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs shadow-sm transition hover:border-indigo-300 dark:border-white/10 dark:bg-zinc-900">
                          <FileText size={17} className="shrink-0 text-indigo-500"/>
                          <span className="min-w-0 truncate font-medium text-slate-700 dark:text-slate-200">{attachment.fileName}</span>
                          <span className="shrink-0 text-[10px] text-slate-400">{(attachment.fileSize / 1024).toFixed(0)} KB</span>
                        </a>}
                    {attachment.kind === "generic" && <p className="mt-1 text-[10px] text-amber-600 dark:text-amber-300">Attached, but this format cannot be analyzed by the model.</p>}
                    {attachment.kind === "spreadsheet" && attachment.fileName.toLowerCase().endsWith(".xls") && <p className="mt-1 text-[10px] text-amber-600 dark:text-amber-300">Legacy XLS workbook is parsed into a compact sheet summary.</p>}
                  </div>)}
                </div> : null}
                {message.imagePending && <div role="status" aria-label="Generating image" className="w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-zinc-950">
                  <div className="aspect-square w-full animate-pulse rounded-xl bg-gradient-to-br from-indigo-500/10 via-violet-500/15 to-slate-400/10"/>
                  <p className="mt-3 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400"><Loader2 size={14} className="animate-spin"/> Creating your image with FLUX.1-schnell…</p>
                </div>}
                {message.imageData && <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white p-2 shadow-sm dark:border-white/10 dark:bg-zinc-950">
                  <Image src={message.imageData} alt="AI-generated image" width={1024} height={1024} unoptimized className="h-auto max-h-[560px] w-full rounded-xl object-contain"/>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" onClick={() => void downloadImage(message.imageData as string)} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/5"><Download size={14}/> Download</button>
                    <a href={message.imageData} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/5"><ImageIcon size={14}/> Open full size</a>
                    <button type="button" onClick={() => void generateImage(message.imagePrompt || "", false)} disabled={busy || !message.imagePrompt} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-40 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/5"><Wand2 size={14}/> Regenerate</button>
                  </div>
                  <p className="mt-2 text-[10px] text-slate-400">Generated with NVIDIA FLUX.1-schnell. AI-generated content may contain inaccuracies.</p>
                </div>}
                {message.sources?.length ? <div className="w-full rounded-xl border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-zinc-950">
                  <p className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300"><Globe2 size={13}/> Sources</p>
                  <div className="space-y-2">{message.sources.map((source, sourceIndex) => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer" className="block rounded-lg p-2 transition hover:bg-slate-50 dark:hover:bg-white/5">
                    <span className="block text-xs font-semibold text-indigo-700 dark:text-indigo-300">[{sourceIndex + 1}] {source.title}</span>
                    <span className="mt-1 block line-clamp-2 text-[11px] leading-4 text-slate-500 dark:text-slate-400">{source.snippet}</span>
                    {source.publishedDate && <span className="mt-1 block text-[10px] text-slate-400">{source.publishedDate}</span>}
                  </a>)}</div>
                </div> : null}
                {message.role === "assistant" && !message.imagePending && !message.imageData && message.content && <div className="flex items-center gap-1 opacity-100 transition duration-150 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                  <button type="button" onClick={() => void copyMessage(message.content)} aria-label="Copy response" title="Copy response" className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:bg-white/10 dark:hover:text-white"><Copy size={14}/></button>
                  <button type="button" onClick={() => void regenerateResponse(index)} aria-label="Regenerate response" title="Regenerate response" disabled={busy} className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-40 dark:hover:bg-white/10 dark:hover:text-indigo-300"><Wand2 size={14}/></button>
                  <button type="button" onClick={() => toggleFeedback(index, "up")} aria-label="Good response" title="Good response" className={"rounded-lg p-2 transition hover:bg-slate-100 dark:hover:bg-white/10 " + (feedback[index] === "up" ? "text-emerald-500" : "text-slate-400")}><ThumbsUp size={14}/></button>
                  <button type="button" onClick={() => toggleFeedback(index, "down")} aria-label="Poor response" title="Poor response" className={"rounded-lg p-2 transition hover:bg-slate-100 dark:hover:bg-white/10 " + (feedback[index] === "down" ? "text-rose-500" : "text-slate-400")}><ThumbsDown size={14}/></button>
                </div>}
                {message.role === "user" && <div className="flex items-center gap-1 opacity-100 transition duration-150 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                  <button type="button" onClick={() => void copyMessage(message.content)} aria-label="Copy message" title="Copy message" className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:bg-white/10 dark:hover:text-white"><Copy size={13}/></button>
                  <button type="button" onClick={() => editMessage(index)} aria-label="Edit message" title="Edit message" className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-medium text-slate-400 transition hover:bg-slate-100 hover:text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:bg-white/10 dark:hover:text-indigo-300"><Pencil size={12}/> Edit</button>
                </div>}
              </div>
              {message.role === "user" && <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-300"><User size={15}/></div>}
            </div>)}
          </div>
        </div>
        {showScrollToBottom && <button type="button" onClick={scrollToBottom} className="absolute bottom-28 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-2 rounded-full border border-slate-200 bg-white/95 px-4 py-2 text-xs font-semibold text-slate-700 shadow-lg backdrop-blur transition hover:border-indigo-300 hover:text-indigo-600 dark:border-white/10 dark:bg-zinc-800/95 dark:text-slate-200 dark:hover:text-indigo-300"><ChevronDown size={14}/> Scroll to latest</button>}
        {error && <div role="alert" aria-live="assertive" className="mx-4 mb-2 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-400/20 dark:bg-rose-400/10 dark:text-rose-300">
          <span>{error}</span>
          {lastImagePrompt && <button type="button" onClick={() => void generateImage(lastImagePrompt, false)} disabled={busy} className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-rose-300/70 px-3 py-1.5 text-xs font-semibold hover:bg-rose-100 disabled:opacity-50 dark:border-rose-300/20 dark:hover:bg-rose-400/10"><Wand2 size={13}/> Retry image</button>}
        </div>}
        <form onSubmit={submit} className="border-t border-slate-200/80 bg-white/80 p-3 backdrop-blur-xl dark:border-white/10 dark:bg-zinc-950/75 sm:p-4">
          {imageMode && <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-xs text-fuchsia-600 dark:text-fuchsia-300"><Wand2 size={13}/> Image generation · NVIDIA FLUX.1-schnell</p>
            <p className="text-xs text-slate-500 dark:text-slate-300">1024 × 1024 · JPEG</p>
          </div>}
          {webSearch && !imageMode && <p className="mb-2 flex items-center gap-2 text-[11px] text-indigo-600 dark:text-indigo-300"><Globe2 size={13}/> Live web search is on. Your prompt is shared with Tavily to find current sources.</p>}
          {attachments.length > 0 && <div className="mb-3 grid gap-2 sm:grid-cols-2">
            {attachments.map(attachment => <div key={attachment.id} className="flex min-w-0 items-center gap-3 rounded-xl border border-slate-200 bg-white p-2.5 dark:border-white/10 dark:bg-zinc-900">
              {attachment.previewUrl ? <Image src={attachment.previewUrl} alt="" width={44} height={44} unoptimized className="h-11 w-11 shrink-0 rounded-lg object-cover"/> : <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-500"><FileText size={20}/></div>}
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-slate-700 dark:text-slate-200">{attachment.fileName}</p>
                <p className="text-[10px] text-slate-400">{(attachment.fileSize / 1024).toFixed(1)} KB · {attachment.status === "uploading" ? "Uploading " + attachment.progress + "%" : attachment.status === "error" ? "Upload failed" : "Ready to send"}</p>
                {attachment.status === "uploading" && <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10"><div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: attachment.progress + "%" }}/></div>}
                {attachment.error && <p className="mt-1 truncate text-[10px] text-rose-500">{attachment.error}</p>}
              </div>
              {attachment.status === "uploaded" && <CheckCircle2 size={16} className="shrink-0 text-emerald-500"/>}
              {attachment.status === "error" && <button type="button" onClick={() => void retryAttachment(attachment.id)} className="shrink-0 rounded-lg px-2 py-1 text-[10px] font-semibold text-indigo-600 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-white/5">Retry</button>}
              <button type="button" onClick={() => removeAttachment(attachment.id)} aria-label={"Remove " + attachment.fileName} className="shrink-0 rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/10 dark:hover:text-white"><X size={15}/></button>
            </div>)}
          </div>}
          {attachments.some(attachment => attachment.kind === "image" && attachment.status === "uploaded") && <p className="mb-2 text-[11px] text-indigo-600 dark:text-indigo-300">Images are analyzed with Nemotron 3.5 Super VL.</p>}
          <input ref={fileInputRef} type="file" multiple className="hidden" aria-label="Choose AI attachments" onChange={event => { if (event.target.files) void addFiles(event.target.files); event.target.value = "" }}/>
          <div className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm transition duration-150 focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-500/10 dark:border-white/10 dark:bg-zinc-900">
            <TextareaAutosize id="ai-prompt" value={input} onChange={event => setInput(event.target.value)} onPaste={handlePaste} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !busy) { event.preventDefault(); void submit(event as unknown as FormEvent) } }} minRows={1} maxRows={6} maxLength={imageMode ? 4000 : 12000} placeholder={imageMode ? "Describe the image you want to generate…" : attachments.length ? "Ask a question about your attachments…" : "Message ChatPlus AI…"} aria-label="Message ChatPlus AI" className="max-h-40 w-full resize-none bg-transparent px-3 py-2 text-sm leading-6 text-slate-900 outline-none placeholder:text-slate-400 dark:text-white"/>
            <div className="flex flex-wrap items-center justify-between gap-2 px-1 pb-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <button type="button" onClick={() => { if (imageMode) setImageMode(false); fileInputRef.current?.click() }} disabled={busy} aria-label="Attach files" title="Attach files or paste an image" className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-40 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-indigo-300"><Paperclip size={16}/></button>
                <select value={mode} onChange={event => setMode(event.target.value as "general" | "coding")} aria-label="Assistant mode" className="max-w-[145px] rounded-lg border-0 bg-slate-100 px-2.5 py-2 text-[11px] font-semibold text-slate-600 outline-none transition hover:bg-slate-200 focus-visible:ring-2 focus-visible:ring-indigo-500 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10">
                  <option value="general">General assistant</option><option value="coding">Coding assistant</option>
                </select>
                <button type="button" onClick={() => { setWebSearch(value => !value); if (!webSearch) setImageMode(false) }} disabled={busy || imageMode} aria-pressed={webSearch} className={"inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-[11px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 " + (webSearch ? "bg-indigo-500/10 text-indigo-600 dark:text-indigo-300" : "text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10")}><Globe2 size={14}/> Web search</button>
                <button type="button" onClick={() => { setImageMode(value => !value); if (!imageMode) setWebSearch(false) }} disabled={busy} aria-pressed={imageMode} className={"inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-[11px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 " + (imageMode ? "bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-300" : "text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10")}><Wand2 size={14}/> Create image</button>
              </div>
              <div className="flex items-center gap-2">
                <span className="hidden text-[10px] text-slate-400 sm:inline">Enter to send · Shift + Enter for newline</span>
                {busy
                  ? <button type="button" onClick={stopGenerating} aria-label="Stop generating" className="inline-flex items-center gap-2 rounded-xl bg-rose-500 px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"><StopCircle size={15}/> Stop</button>
                  : <button type="submit" disabled={attachments.some(attachment => attachment.status !== "uploaded") || (!input.trim() && !attachments.length)} aria-label="Send message" className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-xs font-semibold text-white shadow-md shadow-indigo-600/15 transition duration-150 hover:-translate-y-0.5 hover:from-indigo-700 hover:to-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0"><Send size={14}/> Send</button>}
              </div>
            </div>
          </div>
          <p className="mt-2 text-center text-[10px] text-slate-400">AI can make mistakes. Avoid sharing passwords, private keys, or sensitive personal information.</p>
        </form>
      </section>
    </main>
  )
}
