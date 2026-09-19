"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

function prefersMobilePdfFallback(): boolean {
  if (typeof window === "undefined") return false;
  const ua = navigator.userAgent || "";
  const coarse =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches;
  const narrow = window.matchMedia("(max-width: 768px)").matches;
  // iOS Safari (and many mobile browsers) often blank-out blob PDF iframes.
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const android = /Android/i.test(ua);
  return ios || android || (coarse && narrow);
}

export function PdfViewer({
  materialId,
  title,
}: {
  materialId: string;
  title: string;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [iframeFailed, setIframeFailed] = useState(false);
  const mobileFallback = useMemo(() => prefersMobilePdfFallback(), []);
  const authorizedHref = `/api/study-content/${materialId}`;

  useEffect(() => {
    let revoked: string | null = null;
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    setIframeFailed(false);
    fetch(authorizedHref, {
      signal: ac.signal,
      credentials: "same-origin",
      cache: "no-store",
    })
      .then(async (res) => {
        if (res.status === 403) {
          throw new Error("You do not have access to this PDF.");
        }
        if (!res.ok) throw new Error("Could not load this PDF.");
        return res.blob();
      })
      .then((blob) => {
        if (blob.size === 0) {
          throw new Error("This PDF file is empty.");
        }
        const url = URL.createObjectURL(
          new Blob([blob], { type: "application/pdf" })
        );
        revoked = url;
        setObjectUrl(url);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        setLoading(false);
        setError(err instanceof Error ? err.message : "Could not load this PDF.");
      });
    return () => {
      ac.abort();
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [authorizedHref]);

  const fullscreen = useCallback(() => {
    const node = frameRef.current;
    if (!node) return;
    void node.requestFullscreen?.();
  }, []);

  const openAuthorized = useCallback(() => {
    window.open(authorizedHref, "_blank", "noopener,noreferrer");
  }, [authorizedHref]);

  if (loading) {
    return (
      <div
        className="flex min-h-[50vh] flex-col items-center justify-center gap-3 rounded-xl border bg-card px-4 py-10 text-center text-sm text-muted-foreground"
        data-testid="pdf-loading"
      >
        <p>Loading PDF…</p>
        <p className="text-xs">
          If this stays blank on your phone, use Open in browser below once
          loading finishes.
        </p>
      </div>
    );
  }

  if (error || !objectUrl) {
    return (
      <div
        className="grid gap-4 rounded-xl border border-destructive/30 bg-card px-4 py-8 text-center"
        data-testid="pdf-error"
      >
        <p className="text-sm text-destructive">
          {error ?? "Could not load this PDF."}
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button type="button" size="sm" onClick={openAuthorized}>
            Open in browser
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Opens through your MedVerse session — no public file link.
        </p>
      </div>
    );
  }

  if (mobileFallback || iframeFailed) {
    return (
      <div
        className="grid gap-4 rounded-xl border bg-card px-4 py-8 text-center"
        data-testid="pdf-mobile-fallback"
      >
        <div className="grid gap-1">
          <p className="font-heading text-base font-semibold text-[#072855]">
            {title}
          </p>
          <p className="text-sm text-muted-foreground">
            {iframeFailed
              ? "Inline preview is not available on this device."
              : "On phones, PDFs open most reliably in your browser’s built-in reader."}
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button type="button" onClick={openAuthorized}>
            Open PDF
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Access is checked when you open it. There is no permanent public URL.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-3" data-testid="pdf-viewer">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Use the reader controls for page, zoom, and search.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={openAuthorized}>
            Open in browser
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={fullscreen}>
            Fullscreen
          </Button>
        </div>
      </div>
      <iframe
        ref={frameRef}
        title={title}
        src={`${objectUrl}#toolbar=1`}
        className="min-h-[70vh] w-full rounded-xl border bg-white"
        onError={() => setIframeFailed(true)}
      />
    </div>
  );
}
