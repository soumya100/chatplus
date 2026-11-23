import { db } from "@/lib/db"
import { fetchRedis } from "@/helpers/redis"
import { rateLimit } from "@/lib/ratelimit"
import { createHash, randomInt } from "crypto"

const json = (body: unknown, status = 200) => Response.json(body, { status })
const normalizeEmail = (value: unknown) => typeof value === "string" ? value.trim().toLowerCase() : ""

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    const email = normalizeEmail(body?.email)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 100) return json({ message: "Enter a valid email address." }, 400)

    const ip = (req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown").split(",")[0].trim()
    const [ipLimit, emailLimit] = await Promise.all([
      rateLimit(ip, "email-otp", { limit: 5, windowSeconds: 3600 }),
      rateLimit(email, "email-otp", { limit: 3, windowSeconds: 900 }),
    ])
    if (!ipLimit.success || !emailLimit.success) return json({ message: "Too many OTP requests. Please wait before trying again." }, 429)

    const existing = await fetchRedis("get", `user:email:${email}`)
    if (existing) return json({ message: "An account with this email already exists. Please sign in instead." }, 409)

    const apiKey = process.env.RESEND_API_KEY
    const from = process.env.EMAIL_FROM
    if (!apiKey || !from) return json({ message: "Email verification is not configured yet. Please contact the administrator." }, 503)

    const code = String(randomInt(0, 1_000_000)).padStart(6, "0")
    const codeHash = createHash("sha256").update(`${email}:${code}:${process.env.NEXTAUTH_SECRET || ""}`).digest("hex")
    await db.set(`signup:otp:${email}`, JSON.stringify({ hash: codeHash, attempts: 0, createdAt: Date.now() }), { ex: 600 })
    await db.del(`signup:verified:${email}`)

    const sent = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [email],
        subject: "Your Chat+ verification code",
        html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:28px;color:#0f172a"><h2>Verify your email</h2><p>Use this one-time code to finish creating your Chat+ account.</p><div style="font-size:32px;font-weight:700;letter-spacing:10px;padding:18px;background:#eef2ff;border-radius:12px;text-align:center">${code}</div><p>This code expires in 10 minutes. If you did not request it, you can ignore this email.</p></div>`,
      }),
    })
    if (!sent.ok) {
      await db.del(`signup:otp:${email}`)
      return json({ message: "We couldn't send the verification email. Please try again shortly." }, 502)
    }
    return json({ success: true, message: "Verification code sent. Check your inbox and spam folder." })
  } catch (error) {
    console.error("[email-otp] send failed", error)
    return json({ message: "Unable to send a verification code right now." }, 500)
  }
}
