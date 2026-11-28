import type { Breadcrumb, ErrorEvent } from "@sentry/nextjs";

// INV-006: no Sentry event carries a user's id, email, notes or library. This
// runs as `beforeSend`, after the SDK has collected everything, and keeps only
// what is needed to find the bug: the message, the stack and the URL path.

function stripQuery(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

function scrubBreadcrumb(crumb: Breadcrumb): Breadcrumb {
  if (!crumb.data) return crumb;
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(crumb.data)) {
    data[key] = (key === "url" || key === "from" || key === "to") && typeof value === "string" ? stripQuery(value) : value;
  }
  return { ...crumb, data };
}

export function scrubEvent(event: ErrorEvent): ErrorEvent {
  const out: ErrorEvent = { ...event };
  delete out.user;
  if (event.request) {
    const request = { ...event.request };
    delete request.data;
    delete request.cookies;
    delete request.headers;
    delete request.query_string;
    if (request.url) request.url = stripQuery(request.url);
    out.request = request;
  }
  if (event.breadcrumbs) out.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb);
  return out;
}
