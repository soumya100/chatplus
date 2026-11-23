"use client"

import { useEffect } from "react"

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Keep diagnostic details in the platform logger; never expose them to users.
    console.error("[app-error-boundary]", error)
  }, [error])

  return (
    <main role="alert" aria-labelledby="app-error-title" className="flex min-h-[60vh] items-center justify-center p-6">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-xl dark:border-slate-800 dark:bg-slate-900">
        <h1 id="app-error-title" className="text-xl font-semibold text-slate-900 dark:text-white">Something went wrong</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">This page could not be loaded. Your account and saved messages have not been changed by this error.</p>
        <button type="button" onClick={() => reset()} className="mt-5 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500">Try again</button>
      </section>
    </main>
  )
}
