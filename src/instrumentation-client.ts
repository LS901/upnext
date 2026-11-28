import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "@/lib/observability/options";

// Sentry stays off until NEXT_PUBLIC_SENTRY_DSN is set at build time.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) Sentry.init(sentryOptions(dsn));

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
