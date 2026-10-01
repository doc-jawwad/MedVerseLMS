"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

/**
 * App Router root error boundary — captures render failures for Sentry.
 * Replaces the root layout when triggered; keep markup minimal.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          fontFamily:
            "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif",
          background: "#f7fafc",
          color: "#072855",
        }}
      >
        <main style={{ textAlign: "center", padding: "2rem" }}>
          <p style={{ fontSize: "0.875rem", letterSpacing: "0.04em" }}>
            MedVerse LMS
          </p>
          <h1 style={{ fontSize: "1.5rem", margin: "0.75rem 0" }}>
            Something went wrong
          </h1>
          <p style={{ color: "#334155", maxWidth: "28rem", margin: "0 auto" }}>
            Please try again. If this keeps happening, contact your academy
            admin.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              marginTop: "1.5rem",
              border: 0,
              borderRadius: "0.5rem",
              background: "#05AEA9",
              color: "#fff",
              padding: "0.65rem 1.1rem",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
