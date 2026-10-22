// Whether a request comes from the trusted viewer, the page this server
// served: only it may act as the user (drafts, replies, user comments).
// Fetch Metadata says so directly, but browsers omit it on plain http away
// from localhost (a LAN or tailnet address), where the viewer then looked
// like any other client and every draft call failed. The viewer also names
// itself with a custom header, which a cross-origin caller cannot send: that
// header forces a CORS preflight, and this server answers none, so a sandboxed
// surface (opaque origin) or another site is refused by the browser itself.

export const VIEWER_CLIENT = "viewer";

export function isViewerRequest(request: Request): boolean {
  if (request.headers.get("sec-fetch-site") === "same-origin") return true;
  return request.headers.get("x-mockpit-client") === VIEWER_CLIENT;
}
