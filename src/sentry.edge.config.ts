import * as Sentry from "@sentry/nextjs";
import {
  scrubSentryEvent,
  sharedSentryInitOptions,
} from "@/lib/observability/sentry";

const options = sharedSentryInitOptions("edge");
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
    beforeSend(event) {
      const url =
        typeof event.request?.url === "string" ? event.request.url : "";
      if (url.includes("/api/health")) {
        return null;
      }
      return scrubSentryEvent(event);
    },
  });
}
