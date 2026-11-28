import { describe, expect, it } from "vitest";
import type { ErrorEvent } from "@sentry/nextjs";
import { scrubEvent } from "./scrub";

function fullEvent(): ErrorEvent {
  return {
    type: undefined,
    message: "boom",
    user: { id: "u-1", email: "someone@example.test", ip_address: "203.0.113.9" },
    request: {
      url: "https://upnext.example/library?token=x&q=notes",
      method: "POST",
      data: { note: "my private note" },
      cookies: { session: "abc" },
      headers: { cookie: "session=abc", authorization: "Bearer y" },
      query_string: "token=x",
    },
    breadcrumbs: [
      { category: "navigation", data: { from: "/a?x=1", to: "/library?list=7#top" } },
      { category: "fetch", data: { url: "https://upnext.example/api?id=9", method: "GET" } },
      { category: "console", message: "plain" },
    ],
  };
}

describe("scrubEvent", () => {
  it("removes body, cookies, headers, query string and user", () => {
    const out = scrubEvent(fullEvent());
    expect(out.user).toBeUndefined();
    expect(out.request).not.toHaveProperty("data");
    expect(out.request).not.toHaveProperty("cookies");
    expect(out.request).not.toHaveProperty("headers");
    expect(out.request).not.toHaveProperty("query_string");
    expect(out.request?.method).toBe("POST");
  });

  it("strips the query string and fragment from the request URL", () => {
    expect(scrubEvent(fullEvent()).request?.url).toBe("https://upnext.example/library");
  });

  it("strips query strings from breadcrumb URLs", () => {
    const crumbs = scrubEvent(fullEvent()).breadcrumbs ?? [];
    expect(crumbs[0].data).toEqual({ from: "/a", to: "/library" });
    expect(crumbs[1].data).toEqual({ url: "https://upnext.example/api", method: "GET" });
    expect(crumbs[2].message).toBe("plain");
  });

  it("leaves an event with no request or breadcrumbs alone", () => {
    expect(scrubEvent({ type: undefined, message: "x" })).toEqual({ type: undefined, message: "x" });
  });
});
