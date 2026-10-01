import * as Sentry from "@sentry/nextjs";
import {
  scrubSentryEvent,
  sharedSentryInitOptions,
} from "@/lib/observability/sentry";

// Direct process.env.NEXT_PUBLIC_* reads are required so Next inlines values
// into the browser bundle (indirect env.FOO access is not replaced at build).
const options = sharedSentryInitOptions("client", {
  ...process.env,
  NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  NEXT_PUBLIC_SENTRY_ENVIRONMENT: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
  NEXT_PUBLIC_SENTRY_RELEASE: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
});
if (options) {
  Sentry.init({
    dsn: options.dsn,
    environment: options.environment,
    release: options.release,
    tracesSampleRate: options.tracesSampleRate,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpBodies: [],
      urlQueryParams: false,
      stackFrameVariables: false,
      databaseQueryData: false,
    },
    // No Session Replay — exam/answer UI must not be recorded.
    integrations: [],
    beforeSend(event) {
      return scrubSentryEvent(event);
    },
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
