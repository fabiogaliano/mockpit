// Origins html surfaces may load external resources from. Mirrors the allowlist
// agents already know from Claude's inline widget surface. One list, so the CSP
// and the kit URL check can never disagree about what a sandbox may fetch.
//
// Runtime-agnostic (no node imports).
export const CDN_ALLOWLIST = [
  "https://cdnjs.cloudflare.com",
  "https://esm.sh",
  "https://cdn.jsdelivr.net",
  "https://unpkg.com",
  "https://fonts.googleapis.com",
  "https://fonts.gstatic.com",
];

// A kit URL becomes a <link>/<script> in the sandboxed document, so it must be
// something the CSP would load anyway; anything else would silently fail there.
// Returns the normalized URL, or an error naming the allowed origins.
export function checkCdnUrl(raw: unknown, field: string): { url: string } | { error: string } {
  const allowed = `${field} must be an https URL on ${CDN_ALLOWLIST.map((o) => o.slice(8)).join(", ")}`;
  if (typeof raw !== "string" || raw.length > 2048) return { error: allowed };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { error: allowed };
  }
  if (url.protocol !== "https:" || url.username || url.password) return { error: allowed };
  if (!CDN_ALLOWLIST.includes(url.origin)) return { error: allowed };
  return { url: url.href };
}
