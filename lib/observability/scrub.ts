/**
 * Sentry scrubbing (§6 Observability, §9): never send student names, images,
 * transcriptions, share tokens, cookies or request bodies. We keep only
 * structural info (route, status, error type, stack).
 */
type AnyRecord = Record<string, unknown>;

// /s/<token> (student share links) and long hex/base64url tokens
const TOKEN_PATTERNS: RegExp[] = [/(\/s\/)[^/?#\s]+/g, /\b[a-f0-9]{32,}\b/gi, /\b[A-Za-z0-9_-]{40,}\b/g];

export function redactString(value: string): string {
  let out = value;
  for (const re of TOKEN_PATTERNS)
    out = out.replace(re, (_m, prefix?: string) =>
      typeof prefix === "string" && prefix.startsWith("/") ? `${prefix}[redacted]` : "[redacted]",
    );
  return out;
}

function stripQuery(url: unknown): unknown {
  if (typeof url !== "string") return url;
  const i = url.search(/[?#]/);
  return redactString(i >= 0 ? url.slice(0, i) : url);
}

export function scrubEvent<T extends object>(event: T): T {
  const e = { ...(event as AnyRecord) };
  if (e.request && typeof e.request === "object") {
    const r = { ...(e.request as AnyRecord) };
    delete r.data;
    delete r.cookies;
    delete r.headers;
    delete r.query_string;
    r.url = stripQuery(r.url);
    e.request = r;
  }
  delete e.user;
  delete e.extra;
  if (Array.isArray(e.breadcrumbs)) {
    e.breadcrumbs = (e.breadcrumbs as AnyRecord[]).map((b) => scrubBreadcrumb(b)).filter(Boolean);
  }
  if (typeof e.message === "string") e.message = redactString(e.message);
  if (typeof e.transaction === "string") e.transaction = redactString(e.transaction);
  return e as T;
}

export function scrubBreadcrumb<T extends object>(input: T): T | null {
  const crumb = input as AnyRecord;
  // Console output and UI clicks can carry student names / transcriptions.
  if (crumb.category === "console" || (typeof crumb.category === "string" && crumb.category.startsWith("ui.")))
    return null;
  const c = { ...crumb } as AnyRecord;
  if (typeof c.message === "string") c.message = redactString(c.message);
  if (c.data && typeof c.data === "object") {
    const d = { ...(c.data as AnyRecord) };
    for (const k of ["url", "from", "to"]) if (k in d) d[k] = stripQuery(d[k]);
    delete d.body;
    delete d.request_body;
    delete d.response_body;
    c.data = d;
  }
  return c as T;
}
