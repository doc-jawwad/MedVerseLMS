"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  assignTestOpenListPlacement,
  createTestOpenListGroup,
  deleteTestOpenListGroup,
  renameTestOpenListGroup,
  reorderTestOpenListGroups,
  reorderTestOpenListPlacements,
} from "@/lib/actions/test-open-list";

export type OpenListGroupRow = {
  id: string;
  name: string;
  sort_order: number;
};

export type OpenListTestRow = {
  id: string;
  title: string;
  status: string;
  opens_at: string | null;
  closes_at: string | null;
  group_id: string | null;
  sort_order: number | null;
};

export function OpenListAdmin({
  yearId,
  yearLabel,
  groups: initialGroups,
  tests: initialTests,
}: {
  yearId: string;
  yearLabel: string;
  groups: OpenListGroupRow[];
  tests: OpenListTestRow[];
}) {
  const router = useRouter();
  const [groups, setGroups] = useState(initialGroups);
  const [tests, setTests] = useState(initialTests);
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();

  const sortedGroups = useMemo(
    () =>
      [...groups].sort(
        (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)
      ),
    [groups]
  );

  function refresh() {
    router.refresh();
  }

  function testsInGroup(groupId: string | null) {
    return tests
      .filter((t) => t.group_id === groupId)
      .sort((a, b) => {
        const ao = a.sort_order ?? Number.MAX_SAFE_INTEGER;
        const bo = b.sort_order ?? Number.MAX_SAFE_INTEGER;
        if (ao !== bo) return ao - bo;
        return a.title.localeCompare(b.title);
      });
  }

  const ungroupedUnique = tests
    .filter((t) => t.group_id == null)
    .sort((a, b) => {
      const ao = a.sort_order ?? Number.MAX_SAFE_INTEGER;
      const bo = b.sort_order ?? Number.MAX_SAFE_INTEGER;
      if (ao !== bo) return ao - bo;
      return a.title.localeCompare(b.title);
    });

  return (
    <div className="grid gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.16em] text-primary uppercase">
            {yearLabel}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Open-test groups
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Name groups, assign tests, and reorder how currently open tests appear
            on the student Dashboard. Closed tests stay out of that view. Ungrouped
            tests still appear under &quot;Other tests&quot;.
          </p>
        </div>
        <Button asChild variant="outline" className="h-9">
          <Link href={`/admin/tests?year=${yearId}`}>Back to tests</Link>
        </Button>
      </div>

      <form
        className="flex flex-wrap items-end gap-2 rounded-xl border bg-card p-4"
        onSubmit={(e) => {
          e.preventDefault();
          startTransition(async () => {
            const { error, id } = await createTestOpenListGroup(yearId, name);
            if (error) {
              toast.error(error);
              return;
            }
            toast.success("Group created");
            setName("");
            if (id) {
              setGroups((prev) => [
                ...prev,
                {
                  id,
                  name: name.trim(),
                  sort_order: prev.length,
                },
              ]);
            }
            refresh();
          });
        }}
      >
        <div className="grid min-w-[14rem] flex-1 gap-1">
          <label
            className="text-xs font-medium text-muted-foreground"
            htmlFor="open-list-group-name"
          >
            New group name
          </label>
          <Input
            id="open-list-group-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Block 1 — Midterms"
            disabled={pending}
          />
        </div>
        <Button type="submit" disabled={pending || !name.trim()}>
          Create group
        </Button>
      </form>

      {sortedGroups.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No groups yet. Create a group, then assign tests below.
        </p>
      ) : (
        <ul className="grid gap-4">
          {sortedGroups.map((group, index) => {
            const members = testsInGroup(group.id);
            return (
              <li
                key={group.id}
                className="grid gap-3 rounded-xl border bg-card p-4"
                data-testid={`open-list-group-${group.id}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Input
                    className="max-w-sm font-medium"
                    defaultValue={group.name}
                    disabled={pending}
                    aria-label={`Rename ${group.name}`}
                    onBlur={(e) => {
                      const next = e.target.value.trim();
                      if (!next || next === group.name) return;
                      startTransition(async () => {
                        const { error } = await renameTestOpenListGroup(
                          group.id,
                          next
                        );
                        if (error) toast.error(error);
                        else {
                          setGroups((prev) =>
                            prev.map((g) =>
                              g.id === group.id ? { ...g, name: next } : g
                            )
                          );
                          toast.success("Renamed");
                          refresh();
                        }
                      });
                    }}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={pending || index === 0}
                      onClick={() =>
                        startTransition(async () => {
                          const ids = sortedGroups.map((g) => g.id);
                          const next = [...ids];
                          [next[index - 1], next[index]] = [
                            next[index]!,
                            next[index - 1]!,
                          ];
                          const { error } = await reorderTestOpenListGroups(
                            yearId,
                            next
                          );
                          if (error) toast.error(error);
                          else {
                            toast.success("Groups reordered");
                            refresh();
                          }
                        })
                      }
                    >
                      Move group up
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={pending || index >= sortedGroups.length - 1}
                      onClick={() =>
                        startTransition(async () => {
                          const ids = sortedGroups.map((g) => g.id);
                          const next = [...ids];
                          [next[index], next[index + 1]] = [
                            next[index + 1]!,
                            next[index]!,
                          ];
                          const { error } = await reorderTestOpenListGroups(
                            yearId,
                            next
                          );
                          if (error) toast.error(error);
                          else {
                            toast.success("Groups reordered");
                            refresh();
                          }
                        })
                      }
                    >
                      Move group down
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      disabled={pending}
                      onClick={() =>
                        startTransition(async () => {
                          const { error } = await deleteTestOpenListGroup(
                            group.id
                          );
                          if (error) toast.error(error);
                          else {
                            setGroups((prev) =>
                              prev.filter((g) => g.id !== group.id)
                            );
                            setTests((prev) =>
                              prev.map((t) =>
                                t.group_id === group.id
                                  ? { ...t, group_id: null }
                                  : t
                              )
                            );
                            toast.success("Group deleted (tests ungrouped)");
                            refresh();
                          }
                        })
                      }
                    >
                      Delete group
                    </Button>
                  </div>
                </div>

                {members.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No tests in this group yet.
                  </p>
                ) : (
                  <ul className="grid gap-2">
                    {members.map((test, tIndex) => (
                      <li
                        key={test.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-background/60 px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {test.title}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {test.status}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={pending || tIndex === 0}
                            onClick={() =>
                              startTransition(async () => {
                                const ids = members.map((m) => m.id);
                                const next = [...ids];
                                [next[tIndex - 1], next[tIndex]] = [
                                  next[tIndex]!,
                                  next[tIndex - 1]!,
                                ];
                                const { error } =
                                  await reorderTestOpenListPlacements(
                                    yearId,
                                    group.id,
                                    next
                                  );
                                if (error) toast.error(error);
                                else {
                                  toast.success("Tests reordered");
                                  refresh();
                                }
                              })
                            }
                          >
                            Up
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={pending || tIndex >= members.length - 1}
                            onClick={() =>
                              startTransition(async () => {
                                const ids = members.map((m) => m.id);
                                const next = [...ids];
                                [next[tIndex], next[tIndex + 1]] = [
                                  next[tIndex + 1]!,
                                  next[tIndex]!,
                                ];
                                const { error } =
                                  await reorderTestOpenListPlacements(
                                    yearId,
                                    group.id,
                                    next
                                  );
                                if (error) toast.error(error);
                                else {
                                  toast.success("Tests reordered");
                                  refresh();
                                }
                              })
                            }
                          >
                            Down
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={pending}
                            onClick={() =>
                              startTransition(async () => {
                                const { error } =
                                  await assignTestOpenListPlacement(
                                    test.id,
                                    null
                                  );
                                if (error) toast.error(error);
                                else {
                                  setTests((prev) =>
                                    prev.map((t) =>
                                      t.id === test.id
                                        ? { ...t, group_id: null }
                                        : t
                                    )
                                  );
                                  toast.success("Moved to Other tests");
                                  refresh();
                                }
                              })
                            }
                          >
                            Ungroup
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <section className="grid gap-3 rounded-xl border bg-card p-4">
        <div>
          <h2 className="text-base font-semibold">Ungrouped / assign</h2>
          <p className="text-sm text-muted-foreground">
            Tests without a group still appear on the Dashboard under &quot;Other
            tests&quot; when they are incoming. Assign them to a group here.
          </p>
        </div>
        {ungroupedUnique.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Every test for this class is assigned to a group (or there are no
            tests yet).
          </p>
        ) : (
          <ul className="grid gap-2">
            {ungroupedUnique.map((test) => (
              <li
                key={test.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{test.title}</p>
                  <p className="text-xs text-muted-foreground">{test.status}</p>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Group</span>
                  <select
                    className="h-9 rounded-md border bg-background px-2 text-sm"
                    disabled={pending || sortedGroups.length === 0}
                    defaultValue=""
                    onChange={(e) => {
                      const groupId = e.target.value || null;
                      if (!groupId) return;
                      startTransition(async () => {
                        const { error } = await assignTestOpenListPlacement(
                          test.id,
                          groupId
                        );
                        if (error) toast.error(error);
                        else {
                          setTests((prev) =>
                            prev.map((t) =>
                              t.id === test.id
                                ? { ...t, group_id: groupId }
                                : t
                            )
                          );
                          toast.success("Assigned");
                          refresh();
                        }
                      });
                    }}
                  >
                    <option value="">Select…</option>
                    {sortedGroups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </label>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
