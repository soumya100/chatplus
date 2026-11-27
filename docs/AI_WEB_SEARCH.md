# ChatPlus AI live web search

Live search is optional and user-initiated from the **Search web** control in the AI chat.

## Environment variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `NVIDIA_API_KEY` | Yes for AI chat | — | Server-side NVIDIA NIM API key |
| `TAVILY_API_KEY` | Only for live search | — | Server-side Tavily Search API key |
| `AI_CHAT_ENABLED` | No | enabled | Set to `false` to disable the AI endpoint |
| `AI_CHAT_RATE_LIMIT` | No | `20` | AI requests per user per 10 minutes (clamped to 1–100) |
| `AI_WEB_SEARCH_RATE_LIMIT` | No | `10` | Live searches per user per 10 minutes (clamped to 1–30) |

Never expose either provider key through a `NEXT_PUBLIC_` variable. Add the keys to Vercel Production and Preview environments as appropriate, then redeploy.

## Behavior and safeguards

- Search is opt-in per message; ordinary chat does not call Tavily.
- Search uses Tavily's basic depth and requests at most five results, without full-page extraction.
- The server validates and normalizes result URLs, limits source snippets, and passes them to Nemotron as untrusted reference material.
- The model is instructed to cite claims as `[1]`, `[2]`, etc. The UI renders the matching source list as external links.
- A separate Redis-backed per-user limiter protects search usage in addition to the existing AI chat limiter.
- If search is enabled but Tavily is not configured, rate-limited, or returns no usable sources, the request fails visibly rather than silently answering as if it had searched.

## Free-tier note

Tavily currently advertises 1,000 API credits per month on its free Researcher plan, with no credit card required. Limits and pricing can change; check the provider's current [pricing page](https://www.tavily.com/pricing). The free plan is suitable for prototyping and modest personal use, not an unlimited production guarantee.
