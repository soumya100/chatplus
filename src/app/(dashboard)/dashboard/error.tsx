"use client"

import { useEffect } from "react"

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[dashboard-error-boundary]", error)
  }, [error])

  return (
    <main role="alert" aria-labelledby="dashboard-error-title" className="flex min-h-full items-center justify-center p-6">
      <section className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-lg dark:border-slate-800 dark:bg-slate-900">
        <h1 id="dashboard-error-title" className="text-lg font-semibold">Your chats could not be loaded</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Check your connection and try again. You can safely retry without resending a message.</p>
        <button type="button" onClick={() => reset()} className="mt-4 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500">Retry loading chats</button>
      </section>
    </main>
  )
}
