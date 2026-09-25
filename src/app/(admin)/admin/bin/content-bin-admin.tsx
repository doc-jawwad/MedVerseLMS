"use client";

import { APP_DISPLAY_TIMEZONE } from "@/lib/utils";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { contentBinEntityLabel } from "@/lib/content-bin/labels";
import {
  bulkPurgeContentFromBin,
  bulkRestoreContentFromBin,
  purgeContentFromBin,
  restoreContentFromBin,
  type ContentBinItem,
} from "@/lib/actions/content-bin";
import { CONTENT_BIN_PAGE_SIZE } from "@/lib/content-bin/purge-batch";
import { ConfirmDangerDialog } from "@/components/admin/confirm-danger-dialog";

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toLocaleString("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: APP_DISPLAY_TIMEZONE,
  });
}

function itemKey(item: ContentBinItem): string {
  return `${item.entity_type}:${item.entity_id}`;
}

export function ContentBinAdmin({
  yearLabel,
  yearId,
  items,
  totalCount,
  page,
  pageSize = CONTENT_BIN_PAGE_SIZE,
}: {
  yearLabel: string;
  yearId: string;
  items: ContentBinItem[];
  totalCount: number;
  page: number;
  pageSize?: number;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  const allKeys = useMemo(() => items.map(itemKey), [items]);
  const allSelected =
    allKeys.length > 0 && allKeys.every((k) => selected.has(k));
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const safePage = Math.min(Math.max(page, 1), totalPages);

  function goToPage(next: number) {
    const params = new URLSearchParams();
    params.set("year", yearId);
    if (next > 1) params.set("page", String(next));
    router.push(`/admin/bin?${params.toString()}`);
  }

  function toggleAll() {
    if (allSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        for (const k of allKeys) next.delete(k);
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        for (const k of allKeys) next.add(k);
        return next;
      });
    }
  }

  function toggleOne(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function selectedItems(): ContentBinItem[] {
    return items.filter((i) => selected.has(itemKey(i)));
  }

  /** Include selection keys that may span pages (entityType:entityId). */
  function selectedBulkPayload() {
    const fromPage = selectedItems().map((i) => ({
      entityType: i.entity_type,
      entityId: i.entity_id,
    }));
    // Also include keys selected on other pages that are not in current items
    const pageKeys = new Set(allKeys);
    const extras: { entityType: ContentBinItem["entity_type"]; entityId: string }[] =
      [];
    for (const key of selected) {
      if (pageKeys.has(key)) continue;
      const [entityType, entityId] = key.split(":");
      if (!entityType || !entityId) continue;
      extras.push({
        entityType: entityType as ContentBinItem["entity_type"],
        entityId,
      });
    }
    return [...fromPage, ...extras];
  }

  function runBulkRestore() {
    const list = selectedBulkPayload();
    if (list.length === 0) return;
    startTransition(async () => {
      const res = await bulkRestoreContentFromBin(list);
      if ("error" in res && res.error) {
        toast.error(res.error);
        return;
      }
      const r = res as { restored: number; failed: number };
      toast.success(
        r.failed > 0
          ? `Restored ${r.restored}; ${r.failed} failed`
          : `Restored ${r.restored} item(s)`
      );
      setSelected(new Set());
      router.refresh();
    });
  }

  return (
    <div className="grid gap-6">
      <div>
        <p className="text-[11px] font-semibold tracking-[0.16em] text-primary uppercase">
          {yearLabel}
        </p>
        <h1 className="font-heading text-2xl font-semibold text-[var(--student-ink)]">
          Content Bin
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Soft-deleted academic content. Restore returns it to its previous
          location. Permanent delete is irreversible and queues any R2 objects
          for removal. Students never see the Bin. Soft-deleted items remain
          recoverable until their purge-after time (~7 days).
        </p>
      </div>

      {totalCount === 0 ? (
        <p className="text-sm text-muted-foreground">Bin is empty for this class.</p>
      ) : (
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/80 bg-muted/30 px-3 py-2">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={allSelected}
                onCheckedChange={() => toggleAll()}
                aria-label="Select all visible Bin items on this page"
              />
              <span>
                Select page ({items.length}
                {totalCount > items.length ? ` of ${totalCount}` : ""})
              </span>
            </label>
            <span className="text-xs text-muted-foreground">
              {selected.size} selected
              {selected.size > items.length ? " (across pages)" : ""}
            </span>
            <div className="ml-auto flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending || selected.size === 0}
                onClick={runBulkRestore}
              >
                Bulk restore
              </Button>
              <ConfirmDangerDialog
                destructive
                title={`Permanently delete ${selected.size} item(s)?`}
                description={
                  <p>
                    This permanently removes the selected Bin items from the
                    database. Associated R2 objects (if any) are queued for
                    deletion. Items blocked by test references stay in the Bin.
                    This cannot be undone.
                  </p>
                }
                confirmLabel="Permanently delete selected"
                successMessage={null}
                trigger={
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    disabled={pending || selected.size === 0}
                  >
                    Bulk permanent delete
                  </Button>
                }
                onConfirm={async () => {
                  const list = selectedBulkPayload();
                  const res = await bulkPurgeContentFromBin(list);
                  if ("error" in res && res.error) return { error: res.error };
                  const r = res as Exclude<
                    Awaited<ReturnType<typeof bulkPurgeContentFromBin>>,
                    { error: string }
                  >;
                  if (r.blocked > 0 || r.failed > 0) {
                    toast.warning(r.message);
                  } else {
                    toast.success(r.message);
                  }
                  return {};
                }}
                onSuccess={() => {
                  setSelected(new Set());
                  router.refresh();
                }}
              />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={selected.size === 0}
                onClick={() => setSelected(new Set())}
              >
                Clear selection
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              Showing {(safePage - 1) * pageSize + 1}–
              {Math.min(safePage * pageSize, totalCount)} of {totalCount}
            </span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={safePage <= 1 || pending}
                onClick={() => goToPage(safePage - 1)}
              >
                Previous
              </Button>
              <span>
                Page {safePage} / {totalPages}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={safePage >= totalPages || pending}
                onClick={() => goToPage(safePage + 1)}
              >
                Next
              </Button>
            </div>
          </div>

          <ul className="grid gap-3">
            {items.map((item) => {
              const key = itemKey(item);
              return (
                <li
                  key={key}
                  className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border/80 surface-card p-4 shadow-none transition-colors hover:border-[var(--brand-teal)]/35"
                >
                  <div className="flex min-w-0 flex-1 gap-3">
                    <Checkbox
                      checked={selected.has(key)}
                      onCheckedChange={() => toggleOne(key)}
                      aria-label={`Select ${item.name}`}
                      className="mt-1"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-[var(--student-ink)] break-words">
                          {item.name}
                        </p>
                        <Badge variant="secondary">
                          {contentBinEntityLabel(item.entity_type)}
                        </Badge>
                        {item.has_r2 ? (
                          <Badge variant="outline">R2 retained until purge</Badge>
                        ) : null}
                      </div>
                      <dl className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                        <div>
                          <dt className="inline font-medium text-[var(--student-ink)]">
                            Deleted:{" "}
                          </dt>
                          <dd className="inline">{formatWhen(item.deleted_at)}</dd>
                        </div>
                        <div>
                          <dt className="inline font-medium text-[var(--student-ink)]">
                            Purge after:{" "}
                          </dt>
                          <dd className="inline">
                            {formatWhen(item.purge_after)}
                          </dd>
                        </div>
                      </dl>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={async () => {
                        const { error } = await restoreContentFromBin(
                          item.entity_type,
                          item.entity_id
                        );
                        if (error) {
                          toast.error(error);
                          return;
                        }
                        toast.success("Restored");
                        setSelected((prev) => {
                          const next = new Set(prev);
                          next.delete(key);
                          return next;
                        });
                        router.refresh();
                      }}
                    >
                      Restore
                    </Button>
                    <ConfirmDangerDialog
                      destructive
                      title="Permanently delete?"
                      description={
                        <>
                          <p>
                            This permanently removes “{item.name}” from the
                            database. It cannot be undone.
                          </p>
                          {item.has_r2 ? (
                            <p className="mt-2">
                              Associated R2 object(s) will be queued for
                              deletion. Soft-delete already retained them; this
                              step removes them.
                            </p>
                          ) : null}
                        </>
                      }
                      confirmLabel="Permanently delete"
                      trigger={
                        <Button type="button" size="sm" variant="destructive">
                          Permanent delete
                        </Button>
                      }
                      onConfirm={() =>
                        purgeContentFromBin(item.entity_type, item.entity_id)
                      }
                      onSuccess={() => {
                        setSelected((prev) => {
                          const next = new Set(prev);
                          next.delete(key);
                          return next;
                        });
                        router.refresh();
                      }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
