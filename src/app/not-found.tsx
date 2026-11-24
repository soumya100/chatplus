import Link from "next/link"

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-xl dark:border-slate-800 dark:bg-slate-900">
        <p className="text-sm font-semibold tracking-widest text-indigo-600 dark:text-indigo-400">404</p>
        <h1 className="mt-2 text-2xl font-bold">We can’t find that page</h1>
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">The link may be outdated, or the page may have moved.</p>
        <Link href="/dashboard" className="mt-6 inline-flex rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500">Back to Chat+</Link>
      </section>
    </main>
  )
}
