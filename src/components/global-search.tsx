"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Lock, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import {
  buildStructuralAcademicTree,
  searchAcademicTreeNames,
  type AcademicSearchHit,
  type AcademicTreeSurface,
} from "@/lib/academic-tree";
import {
  filterSearchHitsForAccess,
  mapAcademicSearchRpcRows,
  resolveAcademicSearchHits,
  type AcademicSearchRpcRow,
} from "@/lib/academic-tree/search-resolve";

type GlobalSearchProps = {
  /** Prefer resources for free students; library when subscribed. */
  surface: AcademicTreeSurface;
  yearId: string;
  yearNumber: number;
  yearName: string;
  hasLiveSubscription: boolean;
  /** Sidebar chrome (dark navy) vs content chrome. */
  tone?: "sidebar" | "default";
  className?: string;
};

/**
 * Global name search for class / block / category / folder / day.
 * Prefer `search_academic_tree` (authoritative). Fall back to structural
 * client search when the RPC is unavailable (e.g. admin without enrollment).
 * Tree names only — never MCQs, PDFs, or item payloads.
 */
export function GlobalSearch({
  surface,
  yearId,
  yearNumber,
  yearName,
  hasLiveSubscription,
  tone = "default",
  className,
}: GlobalSearchProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [rpcHits, setRpcHits] = useState<AcademicSearchHit[] | null>(null);
  const [rpcPending, setRpcPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const structuralTree = useMemo(
    () =>
      buildStructuralAcademicTree({
        surface,
        year_id: yearId,
        year_number: yearNumber,
        year_name: yearName,
        has_live_subscription: hasLiveSubscription,
      }),
    [surface, yearId, yearNumber, yearName, hasLiveSubscription]
  );

  const structuralHits = useMemo(
    () =>
      filterSearchHitsForAccess({
        hits: searchAcademicTreeNames({
          query,
          tree: structuralTree,
          limit: 20,
        }),
        surface,
        hasLiveSubscription,
      }),
    [query, structuralTree, surface, hasLiveSubscription]
  );

  const hits = useMemo(
    () =>
      filterSearchHitsForAccess({
        hits: resolveAcademicSearchHits({ rpcHits, structuralHits }),
        surface,
        hasLiveSubscription,
      }),
    [rpcHits, structuralHits, surface, hasLiveSubscription]
  );

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (!q) {
      setRpcHits(null);
      setRpcPending(false);
      return;
    }

    let cancelled = false;
    setRpcPending(true);
    const handle = window.setTimeout(() => {
      void (async () => {
        try {
          const supabase = createClient();
          const { data, error } = await supabase.rpc("search_academic_tree", {
            p_query: q,
            p_limit: 20,
            p_surface: surface,
          });
          if (cancelled) return;
          if (error) {
            // Degrade to structural chrome (access-filtered). Never blank the UI.
            setRpcHits(null);
            return;
          }
          const rows = Array.isArray(data)
            ? data
            : data &&
                typeof data === "object" &&
                Array.isArray((data as { hits?: unknown }).hits)
              ? ((data as { hits: unknown[] }).hits as AcademicSearchRpcRow[])
              : null;
          if (!rows) {
            setRpcHits(null);
            return;
          }
          const mapped = mapAcademicSearchRpcRows({
            rows: rows as AcademicSearchRpcRow[],
            yearName,
            surface,
          });
          // Empty RPC must not block structural fallback (One Liner naming, etc.).
          setRpcHits(mapped.length > 0 ? mapped : null);
        } catch {
          if (!cancelled) setRpcHits(null);
        } finally {
          if (!cancelled) setRpcPending(false);
        }
      })();
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [open, query, surface, yearName]);

  const onKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      setOpen(true);
    }
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onKeyDown]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(t);
  }, [open]);

  const sidebar = tone === "sidebar";

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn(
          "size-9 shrink-0",
          sidebar
            ? "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            : "text-ink hover:bg-accent hover:text-ink",
          className
        )}
        aria-label="Search academic tree"
        title="Search"
        data-testid="shell-search-trigger"
        onClick={() => setOpen(true)}
      >
        <Search className="size-4" />
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setQuery("");
            setRpcHits(null);
          }
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="top-[12%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-lg"
          data-testid="shell-search-dialog"
        >
          <DialogHeader className="sr-only">
            <DialogTitle>Search</DialogTitle>
            <DialogDescription>
              Search class, block, category, folder, and day names only.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Search
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <Input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search folders, blocks, days…"
              className="h-10 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
              aria-label="Search academic tree names"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
            />
            {query ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 shrink-0"
                aria-label="Clear search"
                onClick={() => setQuery("")}
              >
                <X className="size-4" />
              </Button>
            ) : (
              <kbd className="hidden shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground sm:inline">
                ⌘K
              </kbd>
            )}
          </div>

          <div className="max-h-[min(24rem,55vh)] overflow-y-auto overscroll-contain p-2">
            {!query.trim() ? (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                Tree names only — not MCQs, PDFs, or video text.
              </p>
            ) : rpcPending && rpcHits === null && hits.length === 0 ? (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                Searching…
              </p>
            ) : hits.length === 0 ? (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                No matches for “{query.trim()}”.
              </p>
            ) : (
              <ul className="grid gap-1" role="listbox" aria-label="Search results">
                {hits.map((hit) => (
                  <SearchHitRow
                    key={`${hit.kind}:${hit.id}`}
                    hit={hit}
                    onNavigate={() => {
                      setOpen(false);
                      setQuery("");
                      setRpcHits(null);
                    }}
                  />
                ))}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function SearchHitRow({
  hit,
  onNavigate,
}: {
  hit: AcademicSearchHit;
  onNavigate: () => void;
}) {
  return (
    <li>
      <Link
        href={hit.href}
        onClick={onNavigate}
        className={cn(
          "flex items-start justify-between gap-3 rounded-lg px-3 py-2.5 transition-colors",
          "hover:bg-accent focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        )}
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate font-medium text-foreground">
              {hit.name}
            </span>
            <Badge variant="secondary" className="text-[10px] capitalize">
              {hit.kind}
            </Badge>
            {hit.locked && (
              <Badge variant="outline" className="gap-1 text-[10px]">
                <Lock className="size-3" aria-hidden />
                Locked
              </Badge>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            <span className="font-medium text-foreground/70">
              {hit.class_name}
            </span>
            {" · "}
            {hit.path_labels.join(" · ")}
          </p>
        </div>
      </Link>
    </li>
  );
}
