import { db } from "@/lib/db"
import { rateLimit } from "@/lib/ratelimit"
import bcrypt from "bcryptjs"
import { createHash } from "crypto"
import { z } from "zod"

export const dynamic = "force-dynamic"

const schema = z.object({
  email: z.string().email().max(100).transform(value => value.trim().toLowerCase()),
  token: z.string().regex(/^[a-f0-9]{64}$/),
  password: z.string().min(8).max(72)
    .regex(/[A-Z]/, "Password must include an uppercase letter")
    .regex(/[a-z]/, "Password must include a lowercase letter")
    .regex(/[0-9]/, "Password must include a number")
    .regex(/[^A-Za-z0-9]/, "Password must include a special character"),
})

const consumeResetToken = `
-- consume-password-reset-token-v1
local resetRaw = redis.call("GET", KEYS[1])
if not resetRaw or resetRaw ~= ARGV[1] then return 0 end
local latest = redis.call("GET", KEYS[3])
if latest ~= ARGV[4] then return 0 end
local userRaw = redis.call("GET", KEYS[2])
if not userRaw or userRaw ~= ARGV[2] then return -1 end
redis.call("SET", KEYS[2], ARGV[3])
redis.call("DEL", KEYS[1], KEYS[3])
return 1
`

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    const parsed = schema.safeParse(body)
    if (!parsed.success) return Response.json({ message: parsed.error.issues[0]?.message || "Invalid reset request" }, { status: 400 })

    const ip = (req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown").split(",")[0].trim()
    const limiter = await rateLimit(ip, "password-reset-confirm", { limit: 10, windowSeconds: 900 })
    if (!limiter.success) return Response.json({ message: "Too many reset attempts. Please wait and try again." }, { status: 429 })

    const { email, token, password } = parsed.data
    const tokenHash = createHash("sha256").update(token).digest("hex")
    const resetKey = `password-reset:${tokenHash}`
    const rawReset = await db.get(resetKey)
    if (!rawReset) return Response.json({ message: "This reset link is invalid or has expired. Request a new one." }, { status: 400 })

    const resetRaw = typeof rawReset === "string" ? rawReset : JSON.stringify(rawReset)
    const record = (typeof rawReset === "string" ? JSON.parse(rawReset) : rawReset) as { userId: string; emailHash: string; createdAt: number }
    const emailHash = createHash("sha256").update(email).digest("hex")
    if (!record?.userId || record.emailHash !== emailHash || Date.now() - record.createdAt > 30 * 60 * 1000) {
      return Response.json({ message: "This reset link is invalid or has expired. Request a new one." }, { status: 400 })
    }

    const userKey = `user:${record.userId}`
    const rawUser = await db.get(userKey)
    if (!rawUser) return Response.json({ message: "This reset link is invalid or has expired. Request a new one." }, { status: 400 })
    const userRaw = typeof rawUser === "string" ? rawUser : JSON.stringify(rawUser)
    const user = (typeof rawUser === "string" ? JSON.parse(rawUser) : rawUser) as { id: string; email: string; password?: string }
    if (user.email?.toLowerCase() !== email || user.id !== record.userId || !user.password) {
      return Response.json({ message: "This reset link is invalid or has expired. Request a new one." }, { status: 400 })
    }

    const hashedPassword = await bcrypt.hash(password, 12)
    const updatedUser = { ...user, password: hashedPassword, passwordChangedAt: Date.now() }
    const latestResetKey = "password-reset:user:" + record.userId
    const result = await db.eval(consumeResetToken, [resetKey, userKey, latestResetKey], [
      resetRaw,
      userRaw,
      JSON.stringify(updatedUser),
      tokenHash,
    ])
    if (Number(result) === -1) return Response.json({ message: "Your account changed while resetting. Request a new link." }, { status: 409 })
    if (Number(result) !== 1) return Response.json({ message: "This reset link has already been used. Request a new one." }, { status: 400 })

    return Response.json({ success: true, message: "Password updated. Sign in with your new password." })
  } catch (error) {
    console.error("[password-reset] confirmation failed", error)
    return Response.json({ message: "Unable to reset your password right now." }, { status: 500 })
  }
}
