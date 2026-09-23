"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  formatByteSize,
  listOfflineMetas,
  purgeExpiredOffline,
  removeOfflinePdf,
  totalOfflineBytes,
  estimateOfflineQuota,
  type OfflinePdfMeta,
} from "@/lib/study/offline-pdf-store";
import { offlineReaderPath } from "@/lib/pwa/offline-shell";

type RowState = "available" | "saving" | "failed" | "expired";

function rowState(m: OfflinePdfMeta): RowState {
  if (m.saveStatus === "saving") return "saving";
  if (m.saveStatus === "failed") return "failed";
  if (m.entitlementExpiresAt > 0 && Date.now() > m.entitlementExpiresAt) {
    return "expired";
  }
  return "available";
}

function statusLabel(state: RowState): string {
  switch (state) {
    case "saving":
      return "Saving…";
    case "failed":
      return "Failed — Retry";
    case "expired":
      return "Offline access expired";
    default:
      return "Available offline";
  }
}

function formatWhen(ts: number): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return "—";
  }
}

export default function OfflineLibraryPage() {
  const [rows, setRows] = useState<OfflinePdfMeta[]>([]);
  const [usage, setUsage] = useState("");
  const [online, setOnline] = useState(true);

  const refresh = useCallback(async () => {
    await purgeExpiredOffline();
    const list = await listOfflineMetas();
    list.sort((a, b) => b.cachedAt - a.cachedAt);
    setRows(list);
    const used = await totalOfflineBytes();
    const quota = await estimateOfflineQuota();
    if (quota) {
      setUsage(
        `${formatByteSize(used)} used · ${formatByteSize(quota.remaining)} free on device`
      );
    } else {
      setUsage(`${formatByteSize(used)} used`);
    }
  }, []);

  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    void refresh();
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, [refresh]);

  const onRemove = async (id: string) => {
    await removeOfflinePdf(id);
    await refresh();
  };

  return (
    <div className="grid gap-4" data-testid="offline-library">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Offline Library</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Documents you explicitly saved for offline reading.{" "}
          {online ? "You are online." : "You are offline."}
        </p>
        {usage ? (
          <p className="mt-1 text-xs text-muted-foreground" data-testid="offline-library-usage">
            {usage}
          </p>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
          No offline PDFs yet. Open a study PDF online and choose{" "}
          <strong>Save for Offline</strong>.
        </p>
      ) : (
        <ul className="grid gap-3">
          {rows.map((m) => {
            const state = rowState(m);
            return (
              <li
                key={m.materialId}
                className="rounded-lg border bg-card p-4"
                data-testid="offline-library-item"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{m.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatByteSize(m.byteSize)} · saved {formatWhen(m.cachedAt)}
                    </p>
                    <p
                      className="mt-1 text-xs"
                      data-testid="offline-library-status"
                    >
                      {statusLabel(state)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {state === "available" ? (
                      <Button asChild size="sm">
                        <Link href={offlineReaderPath(m.materialId)}>Open</Link>
                      </Button>
                    ) : state === "failed" ? (
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/materials/${m.materialId}/read`}>
                          Retry
                        </Link>
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" disabled>
                        {state === "saving" ? "Saving…" : "Unavailable"}
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => void onRemove(m.materialId)}
                    >
                      Remove offline
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
