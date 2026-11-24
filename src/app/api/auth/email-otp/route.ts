import { db } from "@/lib/db"
import { fetchRedis } from "@/helpers/redis"
import { rateLimit } from "@/lib/ratelimit"
import { isEmailConfigured, sendEmail } from "@/lib/email"
import { createHash, randomBytes, randomInt } from "crypto"

const json = (body: unknown, status = 200) => Response.json(body, { status })
const normalizeEmail = (value: unknown) => typeof value === "string" ? value.trim().toLowerCase() : ""

export async function POST(req: Request) {
  let cooldownKey: string | null = null
  try {
    const body = await req.json().catch(() => null)
    const email = normalizeEmail(body?.email)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 100) return json({ message: "Enter a valid email address." }, 400)

    const ip = (req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown").split(",")[0].trim()
    const [ipLimit, emailLimit] = await Promise.all([
      rateLimit(ip, "email-otp", { limit: 5, windowSeconds: 3600 }),
      rateLimit(createHash("sha256").update(email).digest("hex"), "email-otp", { limit: 3, windowSeconds: 900 }),
    ])
    if (!ipLimit.success || !emailLimit.success) return json({ message: "Too many OTP requests. Please wait before trying again." }, 429)

    const existing = await fetchRedis("get", `user:email:${email}`)
    if (existing) return json({ message: "An account with this email already exists. Please sign in instead." }, 409)

    const emailKey = createHash("sha256").update(email).digest("hex")
    cooldownKey = `signup:otp-cooldown:${emailKey}`
    const cooldown = await db.set(cooldownKey, "1", { nx: true, ex: 60 })
    if (!cooldown) return json({ message: "A code was sent recently. Please wait before requesting another." }, 429)

    if (!isEmailConfigured()) {
      await db.del(cooldownKey)
      return json({ message: "Email verification is not configured yet. Please contact the administrator." }, 503)
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, "0")
    const challengeToken = randomBytes(32).toString("hex")
    const codeHash = createHash("sha256").update(`${email}:${code}:${process.env.NEXTAUTH_SECRET || ""}`).digest("hex")

    await sendEmail({
      to: email,
      subject: "Your Chat+ verification code",
      html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:28px;color:#0f172a"><h2>Verify your email</h2><p>Use this one-time code to finish creating your Chat+ account.</p><div style="font-size:32px;font-weight:700;letter-spacing:10px;padding:18px;background:#eef2ff;border-radius:12px;text-align:center">${code}</div><p>This code expires in 10 minutes. If you did not request it, you can ignore this email.</p></div>`,
    })

    await db.set(`signup:otp:${emailKey}`, JSON.stringify({ hash: codeHash, challengeToken, attempts: 0, createdAt: Date.now() }), { ex: 600 })
    await db.del(`signup:verified:${emailKey}`)
    return json({ success: true, challengeToken, message: "Verification code sent. Check your inbox and spam folder." })
  } catch (error) {
    if (cooldownKey) {
      try { await db.del(cooldownKey) } catch (cleanupError) {
        console.error("[email-otp] failed to clear send cooldown", cleanupError)
      }
    }
    const smtpError = error as { code?: unknown; responseCode?: unknown; command?: unknown }
    console.error("[email-otp] SMTP delivery failed", {
      code: typeof smtpError?.code === "string" ? smtpError.code.slice(0, 80) : undefined,
      responseCode: typeof smtpError?.responseCode === "number" ? smtpError.responseCode : undefined,
      command: typeof smtpError?.command === "string" ? smtpError.command.slice(0, 80) : undefined,
    })
    return json({ message: "We couldn't send the verification email. Please try again shortly." }, 502)
  }
}
