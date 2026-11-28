import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "@/lib/observability/options";

// Sentry stays off until SENTRY_DSN is set on the host.
export function register() {
  const dsn = process.env.SENTRY_DSN;
  if (dsn) Sentry.init(sentryOptions(dsn));
}

export const onRequestError = Sentry.captureRequestError;
