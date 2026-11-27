# ChatPlus AI image generation

ChatPlus AI offers opt-in text-to-image generation using NVIDIA Cosmos3 Nano's hosted preview endpoint.

## Environment variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `NVIDIA_API_KEY` | Yes | — | Server-side NVIDIA API Catalog key, shared with Nemotron |
| `AI_IMAGE_GENERATION_ENABLED` | No | enabled | Set to `false` to disable image generation |
| `AI_IMAGE_RATE_LIMIT` | No | `4` | Per-user image generations per hour (clamped to 1–20) |
| `AI_CHAT_ENABLED` | No | enabled | Existing global AI kill switch; setting it to `false` disables image generation too |

Never expose `NVIDIA_API_KEY` through a `NEXT_PUBLIC_` variable. Add optional controls to Vercel Production and Preview environments, then redeploy.

## Behavior

- Image generation is explicitly selected with **Create image**; ordinary chat and web search remain separate modes.
- The user can choose square, landscape, or portrait output at 480 or 720 resolution.
- The API uses `model_mode: "text2image"` and returns a JPEG image.
- The UI displays the result in the conversation and offers a direct download.
- Generated image data currently lives in browser component state only. It is not stored in Vercel Blob or chat history and is lost on refresh/navigation. Persistent media/history is a separate follow-up.
- The API validates prompt and resolution, requires a signed-in session, applies a Redis-backed per-user quota, validates the returned base64 payload, and limits image response size.

## Free endpoint limitations

NVIDIA currently lists Cosmos3 Nano as a free hosted endpoint for prototyping. NVIDIA states that requests may be rate-limited and traffic from other users can cause throttling; this is not an unlimited production SLA. Generated images are JPEG and carry SynthID watermarking. The hosted API applies safety screening; rejected requests may return HTTP 422.

Official references:
- [Cosmos3 Nano model page](https://build.nvidia.com/nvidia/cosmos3-nano)
- [Cosmos3 Nano API reference](https://build.nvidia.com/nvidia/cosmos3-nano/apireference)
- [Generation modes, sizes, safety and watermarking](https://build.nvidia.com/nvidia/cosmos3-nano/modelcard)
