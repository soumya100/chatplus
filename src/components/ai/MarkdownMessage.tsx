"use client"
import { useMemo, useState, type ReactNode } from "react"
import { Check, Copy } from "lucide-react"

function inline(text: string): ReactNode[] {
  const pattern = /(\*\*[^*]+\*\*|~~[^~]+~~|\x60[^\x60]+\x60|\*[^*]+\*|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g
  return text.split(pattern).filter(Boolean).map((part, index) => {
    const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/)
    if (link) {
      try {
        const url = new URL(link[2])
        if (url.protocol === "https:" || url.protocol === "http:") return <a key={index} href={url.toString()} target="_blank" rel="noopener noreferrer" className="text-indigo-600 underline underline-offset-2 dark:text-indigo-300">{link[1]}</a>
      } catch {}
    }
    if (part.startsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>
    if (part.startsWith("~~")) return <del key={index}>{part.slice(2, -2)}</del>
    if (part.startsWith("*")) return <em key={index}>{part.slice(1, -1)}</em>
    if (part.charCodeAt(0) === 96 && part.charCodeAt(part.length - 1) === 96) return <code key={index} className="rounded bg-slate-100 px-1 py-0.5 font-mono text-indigo-700 dark:bg-slate-950 dark:text-indigo-200">{part.slice(1, -1)}</code>
    return <span key={index}>{part}</span>
  })
}

function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch { setCopied(false) }
  }
  const keywords = new Set(["const","let","var","function","return","if","else","for","while","class","new","this","throw","try","catch","async","await","import","from","export","default","type","interface","def","in","True","False","None","null","undefined","true","false"])
  const highlighted = code.split(/(\/\/[^\n]*|#[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b)/g).filter(Boolean).map((part, index) => {
    if (/^(\/\/|#)/.test(part)) return <span key={index} className="text-slate-500 italic">{part}</span>
    if (/^["']/.test(part)) return <span key={index} className="text-emerald-300">{part}</span>
    if (/^\d/.test(part)) return <span key={index} className="text-amber-300">{part}</span>
    if (keywords.has(part)) return <span key={index} className="text-violet-300">{part}</span>
    return <span key={index} className="text-slate-100">{part}</span>
  })
  return <div className="my-4 overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
    <div className="flex items-center justify-between border-b border-white/10 bg-slate-900 px-3 py-2">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{language || "code"}</span>
      <button type="button" onClick={() => void copy()} aria-label="Copy code" className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-300 hover:bg-white/10">{copied ? <Check size={13}/> : <Copy size={13}/>} {copied ? "Copied" : "Copy"}</button>
    </div>
    <pre className="max-w-full overflow-x-auto p-4 text-xs leading-6"><code className="font-mono">{highlighted}</code></pre>
  </div>
}

function cells(line: string) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(value => value.trim())
}

export default function MarkdownMessage({ content }: { content: string }) {
  const blocks = useMemo(() => {
    const lines = content.replace(/\r\n?/g, "\n").split("\n")
    const result: ReactNode[] = []
    let i = 0
    let key = 0
    while (i < lines.length) {
      const line = lines[i]
      if (!line.trim()) { i++; continue }
      const fence = line.trim().match(/^\x60{3}([\w#+.-]*)/)
      if (fence) {
        const language = fence[1] || "code"
        i++
        const code: string[] = []
        while (i < lines.length && !/^\x60{3}\s*$/.test(lines[i].trim())) code.push(lines[i++])
        if (i < lines.length) i++
        result.push(<CodeBlock key={key++} code={code.join("\n")} language={language}/>)
        continue
      }
      const heading = line.match(/^(#{1,6})\s+(.+)$/)
      if (heading) {
        const size = heading[1].length === 1 ? "text-xl" : heading[1].length === 2 ? "text-lg" : "text-base"
        result.push(<h3 key={key++} className={"mb-2 mt-4 font-semibold text-slate-900 dark:text-white " + size}>{inline(heading[2])}</h3>)
        i++
        continue
      }
      if (/^([-*_]\s*){3,}$/.test(line.trim())) {
        result.push(<hr key={key++} className="my-4 border-slate-200 dark:border-white/10"/>)
        i++
        continue
      }
      if (line.includes("|") && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
        const headers = cells(line)
        i += 2
        const rows: string[][] = []
        while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(cells(lines[i++]))
        result.push(<div key={key++} className="my-4 max-w-full overflow-x-auto rounded-xl border border-slate-200 dark:border-white/10">
          <table className="w-full min-w-[420px] border-collapse text-xs">
            <thead className="bg-slate-100 dark:bg-slate-800"><tr>{headers.map((cell, j) => <th key={j} className="border-b border-slate-200 px-3 py-2 text-left font-semibold dark:border-white/10">{inline(cell)}</th>)}</tr></thead>
            <tbody>{rows.map((row, j) => <tr key={j} className="odd:bg-white even:bg-slate-50 dark:odd:bg-zinc-900 dark:even:bg-zinc-950">{headers.map((_, k) => <td key={k} className="border-t border-slate-100 px-3 py-2 align-top dark:border-white/5">{inline(row[k] || "")}</td>)}</tr>)}</tbody>
          </table>
        </div>)
        continue
      }
      const list = line.match(/^(\s*)([-*+]|\d+\.)\s+(.+)$/)
      if (list) {
        const ordered = /^\d/.test(list[2])
        const items: string[] = []
        while (i < lines.length) {
          const match = lines[i].match(/^(\s*)([-*+]|\d+\.)\s+(.+)$/)
          if (!match || /^\d/.test(match[2]) !== ordered) break
          items.push(match[3]); i++
        }
        const Tag = ordered ? "ol" : "ul"
        result.push(<Tag key={key++} className={ordered ? "my-3 list-decimal space-y-1 pl-6" : "my-3 list-disc space-y-1 pl-6"}>{items.map((item, j) => <li key={j} className="pl-1">{inline(item)}</li>)}</Tag>)
        continue
      }
      if (/^>\s?/.test(line)) {
        const quote: string[] = []
        while (i < lines.length && /^>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^>\s?/, ""))
        result.push(<blockquote key={key++} className="my-3 border-l-2 border-indigo-400 pl-4 text-slate-600 dark:text-slate-300">{quote.map((item, j) => <p key={j}>{inline(item)}</p>)}</blockquote>)
        continue
      }
      const paragraph = [line]
      i++
      while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|\x60{3}|>\s?|(\s*[-*+]|\s*\d+\.)\s)/.test(lines[i])) paragraph.push(lines[i++])
      result.push(<p key={key++} className="my-2 whitespace-pre-wrap leading-7">{inline(paragraph.join("\n"))}</p>)
    }
    return result
  }, [content])
  return <div className="min-w-0 break-words text-[13px] leading-7 text-slate-700 dark:text-slate-200">{blocks}</div>
}
