import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ErrorEvent } from "@sentry/core";
import {
  mapMedverseEnvToSentryEnvironment,
  scrubSensitiveString,
  scrubSensitiveValue,
  scrubSentryEvent,
  sentryClientEnabled,
  sentryServerEnabled,
  sharedSentryInitOptions,
} from "../../src/lib/observability/sentry.ts";

describe("sentry environment gating", () => {
  it("maps MEDVERSE_ENV to Sentry environment names", () => {
    assert.equal(mapMedverseEnvToSentryEnvironment("production"), "production");
    assert.equal(mapMedverseEnvToSentryEnvironment("vps-staging"), "staging");
    assert.equal(mapMedverseEnvToSentryEnvironment("local"), "local");
  });

  it("disables server SDK without DSN or outside staging/production", () => {
    assert.equal(
      sentryServerEnabled({
        MEDVERSE_ENV: "production",
      } as NodeJS.ProcessEnv),
      false
    );
    assert.equal(
      sentryServerEnabled({
        MEDVERSE_ENV: "local",
        SENTRY_DSN: "https://a@o.ingest.sentry.io/1",
      } as NodeJS.ProcessEnv),
      false
    );
    assert.equal(
      sentryServerEnabled({
        MEDVERSE_ENV: "vps-staging",
        SENTRY_DSN: "https://a@o.ingest.sentry.io/1",
      } as NodeJS.ProcessEnv),
      true
    );
  });

  it("requires public environment for client SDK", () => {
    assert.equal(
      sentryClientEnabled({
        NEXT_PUBLIC_SENTRY_DSN: "https://a@o.ingest.sentry.io/1",
        NEXT_PUBLIC_SENTRY_ENVIRONMENT: "staging",
      } as NodeJS.ProcessEnv),
      true
    );
    assert.equal(
      sentryClientEnabled({
        NEXT_PUBLIC_SENTRY_DSN: "https://a@o.ingest.sentry.io/1",
        NEXT_PUBLIC_SENTRY_ENVIRONMENT: "local",
      } as NodeJS.ProcessEnv),
      false
    );
  });

  it("builds conservative sample rates", () => {
    const staging = sharedSentryInitOptions("server", {
      MEDVERSE_ENV: "vps-staging",
      SENTRY_DSN: "https://a@o.ingest.sentry.io/1",
      SENTRY_RELEASE: "abc123",
    } as NodeJS.ProcessEnv);
    assert.ok(staging);
    assert.equal(staging.environment, "staging");
    assert.equal(staging.release, "abc123");
    assert.equal(staging.tracesSampleRate, 0.05);

    const production = sharedSentryInitOptions("server", {
      MEDVERSE_ENV: "production",
      NEXT_PUBLIC_SENTRY_DSN: "https://a@o.ingest.sentry.io/1",
    } as NodeJS.ProcessEnv);
    assert.ok(production);
    assert.equal(production.tracesSampleRate, 0.02);
  });
});

describe("sentry scrubbing", () => {
  it("redacts emails and sensitive keys", () => {
    assert.equal(
      scrubSensitiveString("user student@example.com failed"),
      "user [email] failed"
    );
    const scrubbed = scrubSensitiveValue({
      authorization: "Bearer secret",
      cookie: "sb-auth=xyz",
      note: "ok",
    }) as Record<string, unknown>;
    assert.equal(scrubbed.authorization, "[Filtered]");
    assert.equal(scrubbed.cookie, "[Filtered]");
    assert.equal(scrubbed.note, "ok");
  });

  it("strips user + request cookies/bodies from events", () => {
    const input = {
      type: undefined,
      user: { email: "a@b.com", id: "u1" },
      request: {
        url: "https://lms.example.com/api/x",
        cookies: { a: "1" },
        data: { answer: "B" },
        headers: {
          authorization: "Bearer x",
          "content-type": "application/json",
        },
      },
      message: "boom student@academy.edu",
    } as ErrorEvent;
    const event = scrubSentryEvent(input);
    assert.equal(event.user, undefined);
    assert.equal(event.request?.cookies, undefined);
    assert.equal(event.request?.data, undefined);
    assert.equal(
      (event.request?.headers as Record<string, string>).authorization,
      "[Filtered]"
    );
    assert.equal(event.message, "boom [email]");
  });
});
