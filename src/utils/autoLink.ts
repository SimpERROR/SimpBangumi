/**
 * Shared URL detection and auto-linking utilities.
 *
 * - `autoLinkPlainText`  → for raw plain text (escapes HTML first, then wraps URLs)
 * - `autoLinkInHtml`     → for pre-escaped HTML that may already contain <a> tags
 */

/** Matches http/https URLs, stopping at whitespace / HTML delimiters / common punctuation. */
export const URL_RE = /https?:\/\/[^\s<>"')\]}«»\x00-\x1f]+/gi;

/** Characters commonly used as sentence-ending punctuation after a URL. */
const TRAILING_PUNCTUATION_RE = /[.,;:!?)\]}]+$/;

function cleanUrlTail(raw: string): string {
  return raw.replace(TRAILING_PUNCTUATION_RE, "");
}

function buildAnchor(href: string, display?: string): string {
  const text = display ?? href;
  return `<a href="${href}" target="_blank" rel="noreferrer">${text}</a>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Given raw plain text (possibly containing HTML), escape it and wrap
 * any plain-text URLs in <a> tags so they become clickable.
 */
export function autoLinkPlainText(text: string): string {
  const escaped = escapeHtml(text);
  return escaped.replace(URL_RE, (raw) => {
    const href = cleanUrlTail(raw);
    return buildAnchor(href);
  });
}

/**
 * Given already-HTML-escaped content that may contain existing <a> tags,
 * auto-link any remaining plain-text URLs that are NOT already inside an <a>.
 * Existing <a> tags are preserved unchanged.
 */
export function autoLinkInHtml(html: string): string {
  // Temporarily protect existing <a> tags from modification
  const preserved: string[] = [];
  const protectedHtml = html.replace(/<a\s[^>]*>[\s\S]*?<\/a>/gi, (match) => {
    preserved.push(match);
    return `\x00LINK\x01${preserved.length - 1}\x02`;
  });

  // Auto-link plain URLs in the remaining text
  const autoLinked = protectedHtml.replace(URL_RE, (raw) => {
    const href = cleanUrlTail(raw);
    return buildAnchor(href);
  });

  // Restore preserved <a> tags
  return autoLinked.replace(/\x00LINK\x01(\d+)\x02/g, (_, i: string) => {
    return preserved[Number(i)] ?? "";
  });
}
