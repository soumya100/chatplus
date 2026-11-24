"use client"

import "./globals.css"

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-950 text-slate-100">
        <main role="alert" className="flex min-h-screen items-center justify-center p-6">
          <section className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 text-center shadow-2xl">
            <h1 className="text-xl font-semibold">Chat+ is temporarily unavailable</h1>
            <p className="mt-2 text-sm text-slate-300">A page-level error interrupted the application. Please retry; if it continues, reload Chat+ in a moment.</p>
            <button type="button" onClick={() => reset()} className="mt-5 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400">Reload this page</button>
          </section>
        </main>
      </body>
    </html>
  )
}
