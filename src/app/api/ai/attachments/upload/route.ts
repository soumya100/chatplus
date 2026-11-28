import { handleUpload } from "@vercel/blob/client"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { rateLimit } from "@/lib/ratelimit"

export const runtime = "nodejs"

const MAX_FILE_SIZE = 15 * 1024 * 1024
const OWNER_TTL_SECONDS = 60 * 60 * 24 * 30
const ALLOWED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "application/csv",
  "text/plain",
  "text/markdown",
  "text/x-markdown",
  "application/json",
  "application/octet-stream",
])
const BLOCKED_EXTENSIONS = new Set([
  "html", "htm", "xhtml", "svg", "xml", "js", "mjs", "cjs", "css",
  "exe", "dll", "bat", "cmd", "sh", "ps1", "msi", "jar", "apk",
  "php", "py", "rb", "pl", "com", "scr",
])

function isOwnedBlobUrl(value: unknown): value is string {
  if (typeof value !== "string") return false
  try {
    const url = new URL(value)
    return url.protocol === "https:"
      && !url.username
      && !url.password
      && !url.port
      && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.public\.blob\.vercel-storage\.com$/i.test(url.hostname)
      && url.pathname.length > 1
      && !url.search
      && !url.hash
  } catch {
    return false
  }
}

function safeFilename(value: unknown): string {
  const raw = typeof value === "string" ? value : "attachment"
  const basename = raw.split(/[\\/]/).pop() || "attachment"
  return basename.normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[<>:"|?*]/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 120) || "attachment"
}

export async function POST(request: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return Response.json({ error: "File storage is not configured for this deployment. Add BLOB_READ_WRITE_TOKEN to the Preview environment and redeploy." }, { status: 503 })
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: "Invalid upload request" }, { status: 400 })
  }

  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        const session = await getServerSession(authOptions)
        if (!session?.user?.id) throw new Error("Unauthorized")

        let quota
        try {
          quota = await rateLimit(session.user.id, "ai-attachment-upload", {
            limit: 20,
            windowSeconds: 60 * 60,
          })
        } catch (error) {
          console.error("[ai-attachment-upload] Rate-limit service unavailable", error instanceof Error ? error.message : "unknown error")
          throw new Error("UPLOAD_RATE_LIMIT_UNAVAILABLE")
        }
        if (!quota.success) throw new Error("UPLOAD_RATE_LIMITED")

        const contentType = String(body?.payload?.contentType || "")
          .split(";")[0].trim().toLowerCase()
        if (!ALLOWED_TYPES.has(contentType)) throw new Error("Unsupported file content type")

        const filename = safeFilename(pathname)
        const extension = filename.includes(".") ? filename.split(".").pop()?.toLowerCase() || "" : ""
        if (BLOCKED_EXTENSIONS.has(extension)) throw new Error("This active or executable file format cannot be uploaded")

        return {
          allowedContentTypes: [contentType],
          maximumSizeInBytes: MAX_FILE_SIZE,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({
            userId: session.user.id,
            fileName: filename,
            contentType,
          }),
        }
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        let metadata: { userId?: string } = {}
        try {
          metadata = JSON.parse(tokenPayload || "{}")
        } catch {
          throw new Error("Upload ownership metadata is invalid")
        }
        if (!metadata.userId || !isOwnedBlobUrl(blob.url)) {
          throw new Error("Unable to verify uploaded file ownership")
        }
        await db.set("ai:attachment-owner:" + blob.url, JSON.stringify({
          userId: metadata.userId,
          url: blob.url,
        }), {
          ex: OWNER_TTL_SECONDS,
        })
      },
    })

    return Response.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to upload attachment"
    const status = message === "Unauthorized" ? 401
      : message === "UPLOAD_RATE_LIMITED" ? 429
      : message === "UPLOAD_RATE_LIMIT_UNAVAILABLE" ? 503
      : 400
    if (status >= 500) {
      console.error("[ai-attachment-upload] Blob client-token generation failed", {
        name: error instanceof Error ? error.name : "UnknownError",
        message: message.slice(0, 240),
      })
    }
    const safeMessage = status === 400
      ? "Unable to upload this file. Check its format and size."
      : message
    return Response.json({ error: safeMessage }, { status })
  }
}
