# ChatPlus AI PDF export

ChatPlus AI can export the currently loaded in-browser conversation as a downloadable PDF.

## Runtime and dependencies

- Node.js 22 or newer is required by the server runtime and CI.
- PDF generation uses `pdfnative@1.9.0`, an in-process PDF engine. No external PDF provider or outbound document upload is used.
- Script-specific Noto font data is loaded lazily only when the conversation contains characters from that script. Font subsets are embedded in the generated PDF.

## Configuration

- `AI_PDF_EXPORT_ENABLED=false` disables PDF exports. Export is enabled by default.
- `AI_PDF_RATE_LIMIT=5` sets the per-user hourly export quota (clamped to 1–20).

## Unicode and layout

The exporter preserves Unicode text instead of transliterating it to ASCII. It registers on-demand font data for Devanagari, Bengali, Gujarati, Gurmukhi, Tamil, Telugu, Kannada, Malayalam, Arabic, Hebrew, Thai, Lao, Khmer, Myanmar, Tibetan, Japanese, Simplified Chinese, Korean, Greek, Cyrillic, Latin extended characters, and monochrome emoji.

The document layout uses automatic paragraph direction so mixed left-to-right and right-to-left content can be laid out in logical reading order. Script shaping and font fallback are delegated to the PDF engine's script-aware font pipeline. Actual rendering still needs to be validated against representative generated PDFs and supported readers before the feature is considered production-verified.

## Behavior and safeguards

- `POST /api/ai/pdf` requires an authenticated NextAuth session.
- The route validates message roles, content lengths, source URLs, message count, image count, and total export size.
- PDF generation is local to the application server. Conversation content is not sent to NVIDIA, Tavily, or another third party for export.
- The endpoint returns a PDF attachment with private/no-store caching headers.
- Markdown headings, lists, emphasis, inline code, links, fenced code, and web-search source details are converted to readable document blocks.
- Generated NVIDIA JPEGs are validated and embedded directly in the PDF. At most two RGB JPEG images are accepted, each limited to 1.25 MiB; invalid, oversized, malformed, grayscale, and CMYK JPEG data is rejected.
- Images are placed inline with the corresponding conversation message.
- Conversation content is held in browser state; export covers only the currently loaded conversation and is not persisted for later retrieval.
- The generated PDF is capped at 12 MiB.

## Validation status

The source regression suite covers the authenticated route, rate limiting, image validation, script font registration, Unicode preservation, and automatic text direction. A successful build, runtime PDF generation, visual PDF inspection, and text-extraction verification are still required before production readiness is claimed.
