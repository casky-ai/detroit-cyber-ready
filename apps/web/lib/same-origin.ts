// True only when a browser request came from one of this site's own pages.
// Browsers always send Origin on a cross-site or fetch POST, so a missing
// or foreign Origin means the request did not come from our UI (another
// site, a script, a link preview) and should not be allowed to change state.
export function isSameOrigin(originHeader: string | null, hostHeader: string | null): boolean {
  if (!originHeader || !hostHeader) return false;
  try {
    return new URL(originHeader).host === hostHeader;
  } catch {
    return false;
  }
}
