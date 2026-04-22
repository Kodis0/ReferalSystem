/**
 * Parse CTA / Tilda deep-link query params for registration.
 * Contract: ?site|site_public_id + optional ?ref|ref_code
 *
 * Precedence (deterministic; first match wins per group):
 * - Site id: site_public_id, then site (if both present, site_public_id wins).
 * - Referral: ref_code, then ref (if both present, ref_code wins).
 * - Non-UUID site values are ignored (treated as absent). Empty / whitespace-only
 *   strings are ignored.
 */
const UUID_RE = /^[0-9a-fA-F-]{36}$/;

export function ctaContextFromURLSearchParams(searchParams) {
  if (!searchParams || typeof searchParams.get !== "function") {
    return { site_public_id: undefined, ref: undefined };
  }
  const rawSite =
    searchParams.get("site_public_id") || searchParams.get("site") || "";
  const rawRef =
    searchParams.get("ref_code") || searchParams.get("ref") || "";
  let sitePublicId = rawSite.trim();
  if (sitePublicId && !UUID_RE.test(sitePublicId)) {
    sitePublicId = "";
  }
  const ref = rawRef.trim();
  return {
    site_public_id: sitePublicId || undefined,
    ref: ref || undefined,
  };
}

/** Body for POST /users/site/join/ — aligned with registration signup payload aliases. */
export function buildSiteCtaJoinRequestBody(ctaContext) {
  if (!ctaContext || !ctaContext.site_public_id) return null;
  const body = { site_public_id: ctaContext.site_public_id };
  if (ctaContext.ref) {
    body.ref = ctaContext.ref;
    body.ref_code = ctaContext.ref;
  }
  return body;
}
