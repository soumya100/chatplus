import { db } from "@/lib/db"
import { rateLimit } from "@/lib/ratelimit"
import { createHash } from "crypto"

const json = (body: unknown, status = 200) => Response.json(body, { status })

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : ""
    const code = typeof body?.code === "string" ? body.code.replace(/\s/g, "") : ""
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\d{6}$/.test(code)) return json({ message: "Enter the 6-digit code sent to your email." }, 400)

    const ip = (req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown").split(",")[0].trim()
    const [ipLimit, emailLimit] = await Promise.all([
      rateLimit(ip, "email-otp-verify", { limit: 15, windowSeconds: 900 }),
      rateLimit(email, "email-otp-verify", { limit: 8, windowSeconds: 900 }),
    ])
    if (!ipLimit.success || !emailLimit.success) return json({ message: "Too many verification attempts. Request a new code later." }, 429)

    const raw = await db.get(`signup:otp:${email}`) as string | { hash: string; attempts: number; createdAt: number } | null
    if (!raw) return json({ message: "This code has expired. Request a new one." }, 410)
    const record = (typeof raw === "string" ? JSON.parse(raw) : raw) as { hash: string; attempts: number; createdAt: number }
    if (!record || Date.now() - record.createdAt > 600_000) {
      await db.del(`signup:otp:${email}`)
      return json({ message: "This code has expired. Request a new one." }, 410)
    }
    if (record.attempts >= 5) {
      await db.del(`signup:otp:${email}`)
      return json({ message: "Too many incorrect attempts. Request a new code." }, 429)
    }

    const submitted = createHash("sha256").update(`${email}:${code}:${process.env.NEXTAUTH_SECRET || ""}`).digest("hex")
    if (submitted !== record.hash) {
      const next = { ...record, attempts: record.attempts + 1 }
      if (next.attempts >= 5) await db.del(`signup:otp:${email}`)
      else await db.set(`signup:otp:${email}`, JSON.stringify(next), { ex: Math.max(1, 600 - Math.floor((Date.now() - record.createdAt) / 1000)) })
      return json({ message: next.attempts >= 5 ? "Too many incorrect attempts. Request a new code." : "That code doesn't match. Check it and try again." }, 400)
    }

    await db.set(`signup:verified:${email}`, "1", { ex: 1800 })
    await db.del(`signup:otp:${email}`)
    return json({ success: true, message: "Email verified successfully." })
  } catch (error) {
    console.error("[email-otp] verification failed", error)
    return json({ message: "Unable to verify this code right now." }, 500)
  }
}
