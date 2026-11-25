"use client"

import { FormEvent, useRef, useState } from "react"
import { Bot, ChevronDown, Code2, Download, FileText, Globe2, Image as ImageIcon, Loader2, Send, Sparkles, Trash2, User, Wand2 } from "lucide-react"

type SearchSource = { title: string; url: string; snippet: string; publishedDate?: string }
type ChatMessage = { role: "user" | "assistant"; content: string; sources?: SearchSource[]; imageData?: string }
type Model = "lightning" | "super"
type AssistantMode = "general" | "coding"

export default function AIChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [model, setModel] = useState<Model>("lightning")
  const [mode, setMode] = useState<AssistantMode>("general")
  const [webSearch, setWebSearch] = useState(false)
  const [imageMode, setImageMode] = useState(false)
  const [imageResolution, setImageResolution] = useState("720_1_1")
  const [busy, setBusy] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState("")
  const abortRef = useRef<AbortController | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const prompt = input.trim()
    if (!prompt || busy) return
    if (imageMode) {
      await generateImage(prompt)
      return
    }
    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: prompt }]
    setMessages([...nextMessages, { role: "assistant", content: "" }])
    setInput("")
    setError("")
    setBusy(true)
    const controller = new AbortController()
    abortRef.current = controller

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, mode, webSearch, messages: nextMessages.slice(-20).map(({ role, content }) => ({ role, content })) }),
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
              setMessages([...nextMessages, { role: "assistant", content: answer, sources }])
              continue
            }
            answer += chunk.choices?.[0]?.delta?.content || ""
            setMessages([...nextMessages, { role: "assistant", content: answer, sources }])
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
    } catch (cause) {
      if (!controller.signal.aborted) {
        setMessages(nextMessages)
        setError(cause instanceof Error ? cause.message : "Something went wrong")
      }
    } finally {
      setBusy(false)
      abortRef.current = null
      bottomRef.current?.scrollIntoView({ behavior: "smooth" })
    }
  }

  async function generateImage(prompt: string) {
    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: "Create an image: " + prompt }]
    setMessages(nextMessages)
    setInput("")
    setError("")
    setBusy(true)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const response = await fetch("/api/ai/images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, resolution: imageResolution }),
        signal: controller.signal,
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.message || "Unable to generate image")
      if (typeof payload.image !== "string" || !payload.image.startsWith("data:image/jpeg;base64,")) {
        throw new Error("The image provider returned an invalid image")
      }
      setMessages([...nextMessages, { role: "assistant", content: "", imageData: payload.image }])
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : "Image generation failed")
      }
    } finally {
      setBusy(false)
      abortRef.current = null
      bottomRef.current?.scrollIntoView({ behavior: "smooth" })
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
            content: message.content || (message.imageData ? "[Generated image omitted from PDF export]" : ""),
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
    setError("")
    setBusy(false)
  }

  return (
    <main className="mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col px-4 py-5 sm:px-6">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-indigo-600 p-3 text-white shadow-lg shadow-indigo-600/20"><Sparkles size={22} /></div>
          <div><h1 className="text-xl font-bold text-slate-900 dark:text-white">{mode === "coding" ? "ChatPlus Code" : "ChatPlus AI"}</h1><p className="text-xs text-slate-500 dark:text-slate-400">{imageMode ? "Powered by NVIDIA Cosmos3 Nano" : "Powered by NVIDIA Nemotron"}</p></div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!imageMode && <>
          <label className="sr-only" htmlFor="ai-mode">Assistant mode</label>
          <div className="relative">
            <select id="ai-mode" value={mode} onChange={event => setMode(event.target.value as AssistantMode)} disabled={busy} className="max-w-[150px] appearance-none rounded-xl border border-slate-200 bg-white py-2 pl-3 pr-8 text-xs font-semibold text-slate-700 outline-none focus:border-indigo-500 dark:border-white/10 dark:bg-zinc-900 dark:text-slate-200">
              <option value="general">General chat</option>
              <option value="coding">Coding assistant</option>
            </select>
            <ChevronDown size={14} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-400" />
          </div>
          <label className="sr-only" htmlFor="ai-model">AI model</label>
          <div className="relative">
            <select id="ai-model" value={model} onChange={event => setModel(event.target.value as Model)} disabled={busy} className="max-w-[230px] appearance-none rounded-xl border border-slate-200 bg-white py-2 pl-3 pr-9 text-xs font-semibold text-slate-700 outline-none focus:border-indigo-500 dark:border-white/10 dark:bg-zinc-900 dark:text-slate-200">
              <option value="lightning">Nemotron 3.5 Lightning · Fast</option>
              <option value="super">Nemotron 3.5 Super VL · Advanced</option>
            </select>
            <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
          </div>
          </>}
          <button type="button" onClick={() => { setImageMode(value => !value); if (!imageMode) setWebSearch(false) }} disabled={busy} aria-pressed={imageMode} title={imageMode ? "Image generation is on" : "Create an image"} className={"inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition " + (imageMode ? "border-fuchsia-300 bg-fuchsia-50 text-fuchsia-700 dark:border-fuchsia-400/30 dark:bg-fuchsia-400/10 dark:text-fuchsia-200" : "border-slate-200 text-slate-500 hover:bg-slate-100 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5")}>\n            <ImageIcon size={15}/> Create image\n          </button>\n          {!imageMode && <button type="button" onClick={() => setWebSearch(value => !value)} disabled={busy} aria-pressed={webSearch} title={webSearch ? "Live web search is on" : "Turn on live web search"} className={"inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition " + (webSearch ? "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-400/30 dark:bg-indigo-400/10 dark:text-indigo-200" : "border-slate-200 text-slate-500 hover:bg-slate-100 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5")}>
            <Globe2 size={15}/> Search web
          </button>
          <button type="button" onClick={exportPdf} disabled={!messages.length || busy || exporting} title="Export conversation as PDF" className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5">{exporting ? <Loader2 size={14} className="animate-spin"/> : <FileText size={14}/>} <span className="hidden sm:inline">{exporting ? "Exporting…" : "Export PDF"}</span></button>
          <button type="button" onClick={clearChat} disabled={!messages.length && !busy} title="New chat" className="rounded-xl border border-slate-200 p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/5"><Trash2 size={16}/></button>
        </div>
      </header>
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-zinc-900">
        <div className="flex-1 space-y-5 overflow-y-auto p-4 sm:p-6">
          {!messages.length && <div className="mx-auto flex min-h-full max-w-xl flex-col items-center justify-center text-center">
            <div className="mb-4 rounded-full bg-indigo-50 p-4 text-indigo-600 dark:bg-indigo-400/10 dark:text-indigo-300">{imageMode ? <ImageIcon size={30}/> : mode === "coding" ? <Code2 size={30}/> : <Bot size={30}/>}</div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{imageMode ? "What would you like to create?" : mode === "coding" ? "What are we building or debugging?" : "What would you like to explore?"}</h2>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{imageMode ? "Describe the image you have in mind. ChatPlus will generate a JPEG you can save." : mode === "coding" ? "Get help writing, debugging, refactoring, testing, and reviewing code." : "Ask questions, brainstorm ideas, or switch to Coding assistant for software engineering help."}</p>
            <div className="mt-6 grid w-full gap-2 text-left sm:grid-cols-2">
              {(imageMode ? ["A cinematic mountain landscape at golden hour","A minimal futuristic workspace, warm lighting","A watercolor illustration of a quiet Japanese street","A product photograph of a glass perfume bottle"] : mode === "coding" ? ["Debug this error and explain the root cause","Review this code for bugs and security issues","Write unit tests for this function","Refactor this component for maintainability"] : ["Explain a tricky programming concept","Help me brainstorm an idea","Plan a learning roadmap","Summarize a technical topic"]).map(suggestion => <button key={suggestion} type="button" onClick={() => setInput(suggestion)} className="rounded-xl border border-slate-200 p-3 text-sm text-slate-600 transition hover:border-indigo-300 hover:bg-indigo-50/60 dark:border-white/10 dark:text-slate-300 dark:hover:bg-indigo-400/10">{suggestion}</button>)}
            </div>
          </div>}
          {messages.map((message, index) => <div key={index} className={"flex gap-3 " + (message.role === "user" ? "justify-end" : "justify-start")}>
            {message.role === "assistant" && <div className="mt-1 h-8 w-8 shrink-0 rounded-xl bg-indigo-600 p-2 text-white"><Bot size={16}/></div>}
            <div className="flex max-w-[90%] min-w-0 flex-col items-start gap-2">
              <div className={"max-w-full whitespace-pre-wrap break-words rounded-2xl px-4 py-3 text-sm leading-6 " + (message.role === "user" ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-800 dark:bg-zinc-800 dark:text-slate-100")}>
                {message.content || (busy && index === messages.length - 1 ? <span className="inline-flex items-center gap-2 text-slate-500"><Loader2 size={14} className="animate-spin"/> {imageMode ? "Generating your image…" : "Searching and thinking…"}</span> : null)}
              </div>
              {message.imageData && <div className="w-full overflow-hidden rounded-xl border border-slate-200 bg-white p-2 dark:border-white/10 dark:bg-zinc-950">
                <img src={message.imageData} alt="AI-generated image" className="h-auto max-h-[560px] w-full rounded-lg object-contain" />
                <a href={message.imageData} download="chatplus-generated-image.jpg" className="mt-2 inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/5"><Download size={14}/> Download image</a>
                <p className="mt-2 text-[10px] text-slate-400">Generated with NVIDIA Cosmos3 Nano. AI-generated content may contain inaccuracies.</p>
              </div>}
              {message.sources?.length ? <div className="w-full rounded-xl border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-zinc-950">
                <p className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300"><Globe2 size={13}/> Sources</p>
                <div className="space-y-2">
                  {message.sources.map((source, sourceIndex) => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer" className="block rounded-lg p-2 transition hover:bg-slate-50 dark:hover:bg-white/5">
                    <span className="block text-xs font-semibold text-indigo-700 dark:text-indigo-300">[{sourceIndex + 1}] {source.title}</span>
                    <span className="mt-1 block line-clamp-2 text-[11px] leading-4 text-slate-500 dark:text-slate-400">{source.snippet}</span>
                    {source.publishedDate && <span className="mt-1 block text-[10px] text-slate-400">{source.publishedDate}</span>}
                  </a>)}
                </div>
              </div> : null}
            </div>
            {message.role === "user" && <div className="mt-1 h-8 w-8 shrink-0 rounded-xl bg-slate-200 p-2 text-slate-600 dark:bg-zinc-700 dark:text-slate-200"><User size={16}/></div>}
          </div>)}
          <div ref={bottomRef}/>
        </div>
        {error && <div role="alert" className="mx-4 mb-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-400/20 dark:bg-rose-400/10 dark:text-rose-300">{error}</div>}
        <form onSubmit={submit} className="border-t border-slate-200 p-3 dark:border-white/10 sm:p-4">
          {imageMode && <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-xs text-fuchsia-600 dark:text-fuchsia-300"><Wand2 size={13}/> Image generation mode · NVIDIA Cosmos3 Nano</p>
            <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-300">Size
              <select value={imageResolution} onChange={event => setImageResolution(event.target.value)} disabled={busy} className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs dark:border-white/10 dark:bg-zinc-900">
                <option value="480_1_1">480 · Square</option>
                <option value="480_16_9">480 · Landscape</option>
                <option value="480_9_16">480 · Portrait</option>
                <option value="720_1_1">720 · Square</option>
                <option value="720_16_9">720 · Landscape</option>
                <option value="720_9_16">720 · Portrait</option>
              </select>
            </label>
          </div>}
          {webSearch && !imageMode && <p className="mb-2 flex items-center gap-2 text-xs text-indigo-600 dark:text-indigo-300"><Globe2 size={13}/> Live web search is on. Each message you send is shared with Tavily to find current sources.</p>}
          <div className="flex items-end gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2 focus-within:border-indigo-400 dark:border-white/10 dark:bg-zinc-950">
            <label className="sr-only" htmlFor="ai-prompt">Message ChatPlus AI</label>
            <textarea id="ai-prompt" value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(event as unknown as FormEvent) } }} rows={1} maxLength={imageMode ? 4000 : 12000} placeholder={imageMode ? "Describe the image you want to generate…" : "Message ChatPlus AI…"} className="max-h-40 min-h-10 flex-1 resize-y bg-transparent px-2 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:text-white" />
            <button type="submit" disabled={busy || !input.trim()} aria-label="Send message" className="rounded-xl bg-indigo-600 p-3 text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"><Send size={17}/></button>
          </div>
          <p className="mt-2 text-center text-[11px] text-slate-400">AI can make mistakes. Avoid sharing passwords, private keys, or sensitive personal information.</p>
        </form>
      </section>
    </main>
  )
}
