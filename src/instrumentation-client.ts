import * as Sentry from "@sentry/nextjs";
import {
  scrubSentryEvent,
  sharedSentryInitOptions,
} from "@/lib/observability/sentry";

const options = sharedSentryInitOptions("client");
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
