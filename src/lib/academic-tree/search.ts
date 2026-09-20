import type {
  AcademicSearchHit,
  AcademicTree,
  AcademicTreeFolder,
} from "./types.ts";
import { PROF_SESSION_LABEL } from "./product-structure.ts";
import { hrefForAcademicSearchHit } from "./hit-href.ts";

const DEFAULT_LIMIT = 20;

const SEARCHABLE_KINDS = new Set<AcademicSearchHit["kind"]>([
  "class",
  "block",
  "category",
  "folder",
  "day",
  "prof_session",
]);

/**
 * Client-side name search over a loaded academic tree.
 * Does not search stems, PDF bytes, transcripts, day slots, or item payloads.
 */
export function searchAcademicTreeNames(input: {
  query: string;
  tree: AcademicTree;
  limit?: number;
}): AcademicSearchHit[] {
  const q = normalizeQuery(input.query);
  if (!q) return [];

  const limit = Math.max(1, Math.min(input.limit ?? DEFAULT_LIMIT, 50));
  const hits: AcademicSearchHit[] = [];
  const className = input.tree.year_name;
  const surface = input.tree.surface;

  const tryPush = (
    hit: Omit<AcademicSearchHit, "href"> & { href?: string }
  ) => {
    if (!SEARCHABLE_KINDS.has(hit.kind)) return;
    if (!matchesQuery(hit.name, q)) return;
    hits.push({
      ...hit,
      href: hit.href ?? hrefForAcademicSearchHit(hit, surface),
    });
  };

  tryPush({
    kind: "class",
    id: input.tree.year_id,
    name: className,
    path_labels: [className],
    locked: false,
    class_name: className,
  });

  for (const subject of input.tree.subjects) {
    if (hits.length >= limit) break;

    tryPush({
      kind: "block",
      id: subject.subject_id,
      name: subject.name,
      path_labels: [className, subject.name],
      locked: subject.locked,
      class_name: className,
    });

    for (const category of subject.categories) {
      if (hits.length >= limit) break;

      tryPush({
        kind: "category",
        id: `${subject.subject_id}:${category.id}`,
        name: category.name,
        path_labels: [className, subject.name, category.name],
        locked: category.locked,
        class_name: className,
      });

      walkFolders({
        folders: category.folders,
        path: [className, subject.name, category.name],
        className,
        surface,
        query: q,
        hits,
        limit,
      });
    }
  }

  const prof = input.tree.prof_session;
  if (prof && hits.length < limit) {
    tryPush({
      kind: "prof_session",
      id: `${input.tree.year_id}:prof-session`,
      name: PROF_SESSION_LABEL,
      path_labels: [className, PROF_SESSION_LABEL],
      locked: prof.locked,
      class_name: className,
    });

    walkFolders({
      folders: prof.days,
      path: [className, PROF_SESSION_LABEL],
      className,
      surface,
      query: q,
      hits,
      limit,
    });
  }

  return hits.slice(0, limit);
}

function walkFolders(args: {
  folders: AcademicTreeFolder[];
  path: string[];
  className: string;
  surface: AcademicTree["surface"];
  query: string;
  hits: AcademicSearchHit[];
  limit: number;
}): void {
  for (const folder of args.folders) {
    if (args.hits.length >= args.limit) return;
    if (folder.day_slot) continue;

    const path = [...args.path, folder.name];
    const isDay = Boolean(folder.is_day);

    if (matchesQuery(folder.name, args.query)) {
      const partial = {
        kind: (isDay ? "day" : "folder") as AcademicSearchHit["kind"],
        id: folder.id,
        name: folder.name,
        path_labels: path,
        locked: folder.locked,
        class_name: args.className,
      };
      args.hits.push({
        ...partial,
        href: hrefForAcademicSearchHit(partial, args.surface),
      });
    }

    if (folder.children.length > 0) {
      walkFolders({
        ...args,
        folders: folder.children,
        path,
      });
    }
  }
}

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

function matchesQuery(name: string, query: string): boolean {
  const n = name.toLowerCase();
  if (n.includes(query)) return true;
  const compact = (s: string) => s.replace(/[\s_-]+/g, "");
  return compact(n).includes(compact(query));
}
