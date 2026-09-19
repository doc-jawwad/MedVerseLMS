"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

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

  useEffect(() => {
    let revoked: string | null = null;
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`/api/study-content/${materialId}`, {
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
        const url = URL.createObjectURL(blob);
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
  }, [materialId]);

  const fullscreen = useCallback(() => {
    const node = frameRef.current;
    if (!node) return;
    void node.requestFullscreen?.();
  }, []);

  if (loading) {
    return (
      <div
        className="flex min-h-[70vh] items-center justify-center rounded-xl border bg-card text-sm text-muted-foreground"
        data-testid="pdf-loading"
      >
        Loading PDF…
      </div>
    );
  }

  if (error || !objectUrl) {
    return (
      <div
        className="rounded-xl border border-destructive/30 bg-card px-4 py-8 text-center text-sm text-destructive"
        data-testid="pdf-error"
      >
        {error ?? "Could not load this PDF."}
      </div>
    );
  }

  return (
    <div className="grid gap-3" data-testid="pdf-viewer">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Use the reader controls for page, zoom, and search.
        </p>
        <Button type="button" size="sm" variant="outline" onClick={fullscreen}>
          Fullscreen
        </Button>
      </div>
      <iframe
        ref={frameRef}
        title={title}
        src={objectUrl}
        className="min-h-[70vh] w-full rounded-xl border bg-white"
      />
    </div>
  );
}
