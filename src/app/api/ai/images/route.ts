import { randomUUID } from "node:crypto"
import { getServerSession } from "next-auth"
import { put } from "@vercel/blob"
import { z } from "zod"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { rateLimit } from "@/lib/ratelimit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const requestSchema = z.object({
  prompt: z.string().trim().min(1).max(4000),
}).strict()

const IMAGE_ENDPOINT = "https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-dev"
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const PROVIDER_TIMEOUT_MS = 50_000
const HISTORY_LIMIT = 20
const HISTORY_TTL_SECONDS = 60 * 60 * 24 * 365

type GeneratedImageRecord = {
  id: string
  prompt: string
  imageUrl: string
  mimeType: "image/jpeg"
  model: "black-forest-labs/flux.1-dev"
  createdAt: string
}

function isValidBase64(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length % 4 === 0
    && /^[A-Za-z0-9+/]+={0,2}$/.test(value)
    && Buffer.from(value, "base64").toString("base64") === value
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return Response.json({ message: "Unauthorized" }, { status: 401 })

  try {
    const records = await db.lrange(`ai:generated-images:${session.user.id}`, 0, HISTORY_LIMIT - 1)
    const images = records.flatMap(record => {
      try {
        const parsed = (typeof record === "string" ? JSON.parse(record) : record) as GeneratedImageRecord
        if (!parsed || typeof parsed.imageUrl !== "string" || typeof parsed.prompt !== "string") return []
        return [parsed]
      } catch {
        return []
      }
    })
    return Response.json({ images }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    console.error("[ai-image] Unable to load image history", error)
    return Response.json({ message: "Unable to load your generated images right now." }, { status: 503 })
  }
}

export async function DELETE() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return Response.json({ message: "Unauthorized" }, { status: 401 })
  try {
    await db.del("ai:generated-images:" + session.user.id)
    return Response.json({ cleared: true }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    console.error("[ai-image] Unable to clear image history", error)
    return Response.json({ message: "Unable to clear generated image history." }, { status: 503 })
  }
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return Response.json({ message: "Unauthorized" }, { status: 401 })
  }
  if (process.env.AI_CHAT_ENABLED === "false" || process.env.AI_IMAGE_GENERATION_ENABLED === "false") {
    return Response.json({ message: "AI image generation is temporarily unavailable" }, { status: 503 })
  }

  const apiKey = process.env.NVIDIA_API_KEY
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN
  if (!apiKey) {
    return Response.json({ message: "AI image generation is not configured. Please contact the administrator." }, { status: 503 })
  }
  if (!blobToken) {
    return Response.json({ message: "Image storage is not configured. Please contact the administrator." }, { status: 503 })
  }

  let body: z.infer<typeof requestSchema>
  try {
    body = requestSchema.parse(await request.json())
  } catch {
    return Response.json({ message: "Enter a prompt of up to 4,000 characters." }, { status: 400 })
  }

  const quota = await rateLimit(session.user.id, "ai-image-generation", {
    limit: Math.max(1, Math.min(20, Number(process.env.AI_IMAGE_RATE_LIMIT) || 4)),
    windowSeconds: 60 * 60,
  })
  if (!quota.success) {
    return Response.json({ message: "You've reached the image generation limit. Please try again in an hour." }, {
      status: 429,
      headers: { "Retry-After": "3600" },
    })
  }

  const timeoutSignal = AbortSignal.timeout(PROVIDER_TIMEOUT_MS)
  const signal = AbortSignal.any([request.signal, timeoutSignal])

  try {
    const upstream = await fetch(IMAGE_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        prompt: body.prompt,
        mode: "base",
        cfg_scale: 5,
        width: 1024,
        height: 1024,
        steps: 35,
        samples: 1,
      }),
      signal,
      cache: "no-store",
    })

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => "")
      console.error("[ai-image] NVIDIA FLUX request failed", upstream.status, detail.slice(0, 400))
      if (upstream.status === 422) {
        return Response.json({ message: "The image provider couldn't generate that prompt. Try changing the wording." }, { status: 422 })
      }
      if (upstream.status === 429) {
        return Response.json({ message: "The image provider is busy. Please try again shortly." }, { status: 503 })
      }
      if (upstream.status === 401 || upstream.status === 403) {
        return Response.json({ message: "The image provider rejected the configured API credentials or model access." }, { status: 503 })
      }
      return Response.json({ message: "The image provider could not complete this request. Please retry." }, { status: 502 })
    }

    const result = await upstream.json() as {
      artifacts?: Array<{ base64?: string; finishReason?: string }>
    }
    const artifact = result.artifacts?.[0]
    if (artifact?.finishReason === "CONTENT_FILTERED") {
      return Response.json({ message: "The image provider couldn't create that image because the prompt was blocked by its content policy. Try rephrasing your prompt." }, { status: 422 })
    }
    if (artifact?.finishReason === "ERROR") {
      console.error("[ai-image] NVIDIA FLUX reported an image generation error")
      return Response.json({ message: "The image provider couldn't finish generating this image. Please retry with a simpler prompt." }, { status: 502 })
    }
    if (!isValidBase64(artifact?.base64) || (artifact.finishReason && artifact.finishReason !== "SUCCESS")) {
      console.error("[ai-image] NVIDIA FLUX response did not contain a successful image artifact")
      return Response.json({ message: "The image provider returned an invalid image. Please try again." }, { status: 502 })
    }

    const imageBytes = Buffer.from(artifact.base64, "base64")
    if (imageBytes.length < 4 || imageBytes.length > MAX_IMAGE_BYTES || imageBytes[0] !== 0xff || imageBytes[1] !== 0xd8 || imageBytes[2] !== 0xff) {
      return Response.json({ message: "The generated image was not a supported JPEG or exceeded the 8 MiB limit." }, { status: 502 })
    }

    const id = randomUUID()
    const blob = await put(`ai-generated/${id}.jpg`, imageBytes, {
      access: "public",
      addRandomSuffix: false,
      contentType: "image/jpeg",
      cacheControlMaxAge: 60 * 60 * 24 * 365,
      token: blobToken,
    })

    const record: GeneratedImageRecord = {
      id,
      prompt: body.prompt,
      imageUrl: blob.url,
      mimeType: "image/jpeg",
      model: "black-forest-labs/flux.1-dev",
      createdAt: new Date().toISOString(),
    }

    await db.lpush(`ai:generated-images:${session.user.id}`, JSON.stringify(record))
    await db.ltrim(`ai:generated-images:${session.user.id}`, 0, HISTORY_LIMIT - 1)
    await db.expire(`ai:generated-images:${session.user.id}`, HISTORY_TTL_SECONDS)

    return Response.json({
      image: blob.url,
      mimeType: "image/jpeg",
      model: record.model,
      id,
      createdAt: record.createdAt,
    }, {
      headers: { "Cache-Control": "private, no-store" },
    })
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 })
    if (error instanceof Error && error.name === "TimeoutError") {
      return Response.json({ message: "Image generation took too long. Please retry with a shorter or simpler prompt." }, { status: 504 })
    }
    console.error("[ai-image] Image generation request failed", error)
    return Response.json({ message: "Unable to generate or save the image right now. Please retry." }, { status: 502 })
  }
}
