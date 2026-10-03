/**
 * Branded PWA / cold-start splash.
 * Inline styles keep first paint independent of CSS-chunk timing.
 * Logo is a same-origin PNG (SW-cacheable under /logo-icon-on-dark.png).
 */
export function PwaBootSplash({
  showCredit = true,
}: {
  showCredit?: boolean;
}) {
  return (
    <div
      data-testid="pwa-boot-splash"
      role="status"
      aria-live="polite"
      aria-label="MedVerse loading"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "1rem",
        padding:
          "max(1.5rem, env(safe-area-inset-top)) 1.5rem max(1.5rem, env(safe-area-inset-bottom))",
        backgroundColor: "#072855",
        color: "#ffffff",
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
        textAlign: "center",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- splash must not wait on next/image */}
      <img
        src="/logo-icon-on-dark.png"
        alt=""
        width={72}
        height={72}
        decoding="async"
        style={{ width: 72, height: 72, display: "block" }}
      />
      <div style={{ display: "grid", gap: "0.35rem" }}>
        <p
          style={{
            margin: 0,
            fontSize: "1.5rem",
            fontWeight: 700,
            letterSpacing: "-0.02em",
            lineHeight: 1.2,
          }}
        >
          Med<span style={{ color: "#05aea9" }}>Verse</span>
        </p>
        {showCredit ? (
          <p
            style={{
              margin: 0,
              fontSize: "0.8125rem",
              fontWeight: 500,
              letterSpacing: "0.04em",
              color: "rgba(255,255,255,0.72)",
            }}
          >
            MedDesk.pk
          </p>
        ) : null}
      </div>
    </div>
  );
}
