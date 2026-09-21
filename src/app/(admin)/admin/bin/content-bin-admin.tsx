"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { contentBinEntityLabel } from "@/lib/content-bin/labels";
import {
  purgeContentFromBin,
  restoreContentFromBin,
  type ContentBinItem,
} from "@/lib/actions/content-bin";
import { ConfirmDangerDialog } from "@/components/admin/confirm-danger-dialog";

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ContentBinAdmin({
  yearLabel,
  items,
}: {
  yearLabel: string;
  items: ContentBinItem[];
}) {
  const router = useRouter();

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
          for removal. Students never see the Bin.
        </p>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Bin is empty for this class.</p>
      ) : (
        <ul className="grid gap-3">
          {items.map((item) => (
            <li
              key={`${item.entity_type}:${item.entity_id}`}
              className="flex flex-wrap items-start justify-between gap-3 rounded-xl border bg-card p-4"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-[var(--student-ink)]">{item.name}</p>
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
                    <dd className="inline">{formatWhen(item.purge_after)}</dd>
                  </div>
                </dl>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
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
                        This permanently removes “{item.name}” from the database.
                        It cannot be undone.
                      </p>
                      {item.has_r2 ? (
                        <p className="mt-2">
                          Associated R2 object(s) will be queued for deletion.
                          Soft-delete already retained them; this step removes them.
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
                  onSuccess={() => router.refresh()}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
