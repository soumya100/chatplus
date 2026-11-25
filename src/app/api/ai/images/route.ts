import { getServerSession } from "next-auth"
import { z } from "zod"
import { authOptions } from "@/lib/auth"
import { rateLimit } from "@/lib/ratelimit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const requestSchema = z.object({
  prompt: z.string().trim().min(1).max(4000),
  resolution: z.enum(["480_1_1", "480_16_9", "480_9_16", "720_1_1", "720_16_9", "720_9_16"]).default("720_1_1"),
}).strict()

const IMAGE_ENDPOINT = "https://ai.api.nvidia.com/v1/cosmos/nvidia/cosmos3-nano"
const MAX_IMAGE_BYTES = 8 * 1024 * 1024

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return Response.json({ message: "Unauthorized" }, { status: 401 })
  }
  if (process.env.AI_CHAT_ENABLED === "false" || process.env.AI_IMAGE_GENERATION_ENABLED === "false") {
    return Response.json({ message: "AI image generation is temporarily unavailable" }, { status: 503 })
  }

  const apiKey = process.env.NVIDIA_API_KEY
  if (!apiKey) {
    return Response.json({ message: "AI image generation is not configured. Please contact the administrator." }, { status: 503 })
  }

  let body: z.infer<typeof requestSchema>
  try {
    body = requestSchema.parse(await request.json())
  } catch {
    return Response.json({ message: "Enter a prompt (up to 4,000 characters) and choose a supported image size." }, { status: 400 })
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

  try {
    const upstream = await fetch(IMAGE_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model_mode: "text2image",
        prompt: body.prompt,
        resolution: body.resolution,
        num_frames: 1,
        num_inference_steps: 35,
        guidance_scale: 4,
      }),
      signal: request.signal,
      cache: "no-store",
    })

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => "")
      console.error("[ai-image] NVIDIA image request failed", upstream.status, detail.slice(0, 400))
      if (upstream.status === 422) {
        return Response.json({ message: "The image provider couldn't generate that prompt. Try changing the wording." }, { status: 422 })
      }
      if (upstream.status === 429) {
        return Response.json({ message: "The image provider is busy. Please try again shortly." }, { status: 503 })
      }
      return Response.json({ message: "The image provider could not complete this request." }, { status: 502 })
    }

    const result: { b64_image?: string | null } = await upstream.json()
    const image = result.b64_image
    if (typeof image !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(image)) {
      console.error("[ai-image] NVIDIA response did not contain a valid base64 image")
      return Response.json({ message: "The image provider returned an invalid image. Please try again." }, { status: 502 })
    }

    const estimatedBytes = Math.floor(image.length * 3 / 4)
    if (estimatedBytes < 1 || estimatedBytes > MAX_IMAGE_BYTES) {
      return Response.json({ message: "The generated image exceeded the supported size. Try a smaller resolution." }, { status: 502 })
    }

    return Response.json({
      image: "data:image/jpeg;base64," + image,
      mimeType: "image/jpeg",
      model: "nvidia/cosmos3-nano",
      resolution: body.resolution,
    }, {
      headers: { "Cache-Control": "no-store" },
    })
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 })
    console.error("[ai-image] Image generation request failed", error)
    return Response.json({ message: "Unable to connect to the image generation provider." }, { status: 502 })
  }
}
