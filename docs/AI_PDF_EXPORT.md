# ChatPlus AI PDF export

ChatPlus AI can export the current in-browser conversation as a downloadable PDF.

## Configuration

- `AI_PDF_EXPORT_ENABLED=false` disables PDF exports. Export is enabled by default.
- `AI_PDF_RATE_LIMIT=5` sets the per-user hourly export quota (clamped to 1–20).
- No external PDF provider, paid service, or additional npm dependency is required.

## Behavior and safeguards

- `POST /api/ai/pdf` requires an authenticated NextAuth session.
- The route validates message roles, content lengths, source URLs, message count, and total export size.
- PDF generation is local to the application server. Conversation content is not sent to NVIDIA, Tavily, or another third party for export.
- The endpoint returns a PDF attachment with private/no-store caching headers.
- Standard PDF Helvetica text is used. Markdown headings, lists, emphasis, inline code, links, fenced code, and web-search source details are converted to readable plain text.
- Unicode characters outside the standard PDF text encoding are transliterated or replaced; complex scripts may not render faithfully.
- Generated image bytes are not embedded in this text export. Image messages are represented by their accompanying text, if any.
- Conversation content is held in browser state in this phase; it is not persisted as server-side AI history.
