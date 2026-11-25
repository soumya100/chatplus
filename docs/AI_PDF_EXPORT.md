# ChatPlus AI PDF export

ChatPlus AI can export the currently loaded in-browser conversation as a downloadable PDF.

## Configuration

- `AI_PDF_EXPORT_ENABLED=false` disables PDF exports. Export is enabled by default.
- `AI_PDF_RATE_LIMIT=5` sets the per-user hourly export quota (clamped to 1–20).
- No external PDF provider, paid service, or additional npm dependency is required.

## Behavior and safeguards

- `POST /api/ai/pdf` requires an authenticated NextAuth session.
- The route validates message roles, content lengths, source URLs, message count, and total export size.
- PDF generation is local to the application server. Conversation content is not sent to NVIDIA, Tavily, or another third party for export.
- The endpoint returns a PDF attachment with private/no-store caching headers.
- Markdown headings, lists, emphasis, inline code, links, fenced code, and web-search source details are converted to readable text.
- Generated NVIDIA JPEGs are embedded directly in the PDF. At most two RGB JPEG images are accepted, each limited to 1.25 MiB; invalid, oversized, malformed, grayscale, and CMYK JPEG data is rejected. The combined request is capped at 3.7 MB to stay within typical serverless request-body limits.
- Images are scaled to fit the page and placed inline with the related conversation message.
- Standard PDF Helvetica text is still used. Characters outside its supported encoding are transliterated or replaced; this phase does not yet provide full Unicode script shaping.
- Conversation content is held in browser state; export covers only the currently loaded conversation and is not persisted for later retrieval.

## Environment

No new required variables. Optional server-side controls:

- `AI_PDF_EXPORT_ENABLED=false` disables PDF export.
- `AI_PDF_RATE_LIMIT=5` sets the per-user hourly export quota.
