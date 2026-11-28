import { scrubEvent } from "./scrub";

// Shared Sentry options. Sentry is off unless a DSN is given: callers pass
// SENTRY_DSN (server) or NEXT_PUBLIC_SENTRY_DSN (browser) and skip `init`
// when it is empty.
export function sentryOptions(dsn: string) {
  return {
    dsn,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend: scrubEvent,
  };
}
