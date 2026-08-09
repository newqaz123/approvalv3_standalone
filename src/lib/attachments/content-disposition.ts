/**
 * Injection-safe Content-Disposition header builder.
 *
 * Produces a header value with a legacy ASCII `filename` plus an RFC 5987
 * `filename*` parameter so non-ASCII (e.g. Thai) filenames round-trip in modern
 * browsers while staying valid in legacy ones.
 *
 * Security notes:
 * - Control characters (CR/LF/NUL/etc.) and the double-quote are stripped from
 *   the source name so the value can never split or inject additional headers.
 * - When the original name contains non-ASCII characters, the ASCII `filename`
 *   falls back to a neutral `attachment` base (extension preserved). We do not
 *   emit a partially-transliterated or truncated name, and we never echo raw
 *   caller bytes into the header. The real name travels only in the
 *   percent-encoded `filename*`.
 * - The ASCII segment has any remaining quote/backslash neutralized to `_`.
 */
export function buildContentDisposition(
  disposition: 'inline' | 'attachment',
  originalName: string
): string {
  const cleaned = originalName.replace(/[\r\n\u0000-\u001f\u007f"]/g, '').trim() || 'attachment'
  const extension = cleaned.match(/\.[A-Za-z0-9]{1,10}$/)?.[0] ?? ''
  const hasNonAscii = /[^\x20-\x7E]/.test(cleaned)
  // Non-ASCII names cannot be represented in the legacy ASCII parameter; use a
  // neutral base there and carry the real name via `filename*`.
  const asciiBase = hasNonAscii
    ? 'attachment'
    : (cleaned.replace(extension, '').trim() || 'attachment')
  const ascii = `${asciiBase.slice(0, 120)}${extension}`.replace(/["\\]/g, '_')
  const encoded = encodeURIComponent(cleaned).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  )
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encoded}`
}
