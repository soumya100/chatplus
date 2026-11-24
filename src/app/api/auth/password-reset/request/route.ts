import { db } from "@/lib/db"
import { fetchRedis } from "@/helpers/redis"
import { rateLimit } from "@/lib/ratelimit"
import { isEmailConfigured, sendEmail } from "@/lib/email"
import { createHash, randomBytes } from "crypto"

export const dynamic = "force-dynamic"

const issueResetToken = `
-- issue-password-reset-token-v1
local previous = redis.call("GET", KEYS[2])
if previous then redis.call("DEL", "password-reset:" .. previous) end
redis.call("SET", KEYS[1], ARGV[1], "EX", ARGV[2])
redis.call("SET", KEYS[2], ARGV[3], "EX", ARGV[2])
return 1
`

const cleanupResetToken = `
-- cleanup-password-reset-token-v1
if redis.call("GET", KEYS[2]) == ARGV[1] then
  redis.call("DEL", KEYS[1], KEYS[2])
  return 1
end
return 0
`
const generic = "If an account matches that email, password reset instructions will be sent shortly."
const json = (body: unknown, status = 200) => Response.json(body, { status })

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : ""
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 100) {
      return json({ message: "Enter a valid email address." }, 400)
    }

    const ip = (req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown").split(",")[0].trim()
    const emailHash = createHash("sha256").update(email).digest("hex")
    const [ipLimit, emailLimit] = await Promise.all([
      rateLimit(ip, "password-reset-request", { limit: 5, windowSeconds: 3600 }),
      rateLimit(emailHash, "password-reset-request", { limit: 3, windowSeconds: 3600 }),
    ])
    if (!ipLimit.success || !emailLimit.success) {
      return json({ message: generic }, 200)
    }

    const userId = await fetchRedis("get", `user:email:${email}`) as string | null
    if (!userId) return json({ success: true, message: generic })

    const rawUser = await db.get(`user:${userId}`)
    if (!rawUser) return json({ success: true, message: generic })
    const user = (typeof rawUser === "string" ? JSON.parse(rawUser) : rawUser) as { id: string; email: string; name?: string; password?: string }
    if (!user.password || user.id !== userId || user.email?.toLowerCase() !== email) {
      return json({ success: true, message: generic })
    }

    if (!isEmailConfigured()) {
      console.error("[password-reset] SMTP email provider is not configured")
      return json({ success: true, message: generic })
    }

    const token = randomBytes(32).toString("hex")
    const tokenHash = createHash("sha256").update(token).digest("hex")
    const resetKey = `password-reset:${tokenHash}`
    const configuredBaseUrl = process.env.NEXTAUTH_URL
    if (!configuredBaseUrl) {
      console.error("[password-reset] NEXTAUTH_URL is not configured")
      return json({ success: true, message: generic })
    }
    let baseUrl: URL
    try {
      baseUrl = new URL(configuredBaseUrl)
      if (baseUrl.username || baseUrl.password ||
          (process.env.NODE_ENV === "production" && baseUrl.protocol !== "https:")) {
        throw new Error("Untrusted password reset origin")
      }
    } catch {
      console.error("[password-reset] NEXTAUTH_URL is invalid")
      return json({ success: true, message: generic })
    }

    const userResetKey = "password-reset:user:" + userId
    const record = JSON.stringify({ userId, emailHash, createdAt: Date.now() })
    const issued = await db.eval(issueResetToken, [resetKey, userResetKey], [record, "1800", tokenHash])
    if (Number(issued) !== 1) return json({ success: true, message: generic })

    const resetUrl = new URL("/reset-password", baseUrl.origin)
    resetUrl.searchParams.set("token", token)
    resetUrl.searchParams.set("email", email)
    const safeName = (user.name || "there").slice(0, 80).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\x27/g, "&#x27;")

    try {
      await sendEmail({
        to: email,
        subject: "Reset your Chat+ password",
        html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:28px;color:#0f172a"><h2>Reset your password</h2><p>Hello ${safeName},</p><p>We received a request to reset your Chat+ password. This link expires in 30 minutes and can only be used once.</p><p><a href="${resetUrl.toString()}" style="display:inline-block;background:#4f46e5;color:white;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600">Reset password</a></p><p>If you did not request this, you can ignore this email. Your current password will remain unchanged.</p></div>`,
      })
    } catch (error) {
      await db.eval(cleanupResetToken, [resetKey, userResetKey], [tokenHash])
      const smtpError = error as { code?: unknown; responseCode?: unknown; command?: unknown }
      console.error("[password-reset] SMTP delivery failed", {
        code: typeof smtpError?.code === "string" ? smtpError.code.slice(0, 80) : undefined,
        responseCode: typeof smtpError?.responseCode === "number" ? smtpError.responseCode : undefined,
        command: typeof smtpError?.command === "string" ? smtpError.command.slice(0, 80) : undefined,
      })
    }
    return json({ success: true, message: generic })
  } catch (error) {
    console.error("[password-reset] request failed", error)
    return json({ success: true, message: generic })
  }
}
