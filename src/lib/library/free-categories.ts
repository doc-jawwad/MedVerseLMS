import { belongsOnFreeResources } from "./free-surface.ts";
import {
  LIBRARY_META,
  STUDENT_LIBRARY_TYPES,
  type FolderLibraryType,
  type StudentLibraryType,
} from "./types.ts";

export type FreeCategoryCard = {
  id: StudentLibraryType;
  slug: string;
  label: string;
  href: string;
  description: string;
  itemCount: number;
  subjectCount: number;
  latestUpdate: string | null;
};

export type FreeMcqSubject = {
  subject_id: string;
  granted: boolean;
  approved_questions: number;
  entitlement: string;
  hasPersonalGrant?: boolean;
};

export type FreeFolderRow = {
  id: string;
  library_type: string;
  subject_id: string | null;
  entitlement: string;
  updated_at?: string | null;
};

export type FreeMaterialRow = {
  folder_id: string;
  updated_at?: string | null;
};

export type FreePearlRow = {
  id: string;
  subject_id: string;
  entitlement: string;
  updated_at?: string | null;
};

function maxIso(values: Array<string | null | undefined>): string | null {
  let best: string | null = null;
  for (const v of values) {
    if (!v) continue;
    if (!best || Date.parse(v) > Date.parse(best)) best = v;
  }
  return best;
}

/**
 * Free Resources landing: only categories that currently contain usable
 * curated free / personally granted published items. Empty tiles are omitted.
 * Paid-only items unlocked by subscription must not appear here.
 */
export function buildFreeResourceCategories(input: {
  practice: readonly FreeMcqSubject[];
  folders: readonly FreeFolderRow[];
  accessibleFolderIds: readonly string[];
  grantedFolderIds?: readonly string[];
  materials: readonly FreeMaterialRow[];
  pearls: readonly FreePearlRow[];
  accessiblePearlIds: readonly string[];
}): FreeCategoryCard[] {
  const accessibleFolders = new Set(input.accessibleFolderIds);
  const grantedFolders = new Set(input.grantedFolderIds ?? []);
  const accessiblePearls = new Set(input.accessiblePearlIds);
  const materialsByFolder = new Map<string, FreeMaterialRow[]>();
  for (const m of input.materials) {
    const list = materialsByFolder.get(m.folder_id) ?? [];
    list.push(m);
    materialsByFolder.set(m.folder_id, list);
  }

  const cards: FreeCategoryCard[] = [];

  for (const id of STUDENT_LIBRARY_TYPES) {
    const meta = LIBRARY_META[id];
    if (id === "mcq_bank") {
      const subjects = input.practice.filter(
        (s) =>
          belongsOnFreeResources({
            entitlement: s.entitlement,
            hasPersonalGrant: s.hasPersonalGrant,
            accessible: s.granted,
          }) && s.approved_questions > 0
      );
      if (subjects.length === 0) continue;
      cards.push({
        id,
        slug: meta.slug,
        label: meta.label,
        href: meta.freeHref,
        description: meta.description,
        itemCount: subjects.reduce((n, s) => n + s.approved_questions, 0),
        subjectCount: subjects.length,
        latestUpdate: null,
      });
      continue;
    }

    if (id === "pearl_points") {
      const pearls = input.pearls.filter((p) =>
        belongsOnFreeResources({
          entitlement: p.entitlement,
          accessible: accessiblePearls.has(p.id),
        })
      );
      if (pearls.length === 0) continue;
      const subjects = new Set(pearls.map((p) => p.subject_id));
      cards.push({
        id,
        slug: meta.slug,
        label: meta.label,
        href: meta.freeHref,
        description: meta.description,
        itemCount: pearls.length,
        subjectCount: subjects.size,
        latestUpdate: maxIso(pearls.map((p) => p.updated_at)),
      });
      continue;
    }

    const folderType = meta.folderType as FolderLibraryType;
    const folders = input.folders.filter(
      (f) =>
        f.library_type === folderType &&
        belongsOnFreeResources({
          entitlement: f.entitlement,
          hasPersonalGrant: grantedFolders.has(f.id),
          accessible: accessibleFolders.has(f.id),
        })
    );
    const items = folders.flatMap((f) => materialsByFolder.get(f.id) ?? []);
    if (items.length === 0) continue;
    const subjects = new Set(
      folders.map((f) => f.subject_id).filter((s): s is string => Boolean(s))
    );
    cards.push({
      id,
      slug: meta.slug,
      label: meta.label,
      href: meta.freeHref,
      description: meta.description,
      itemCount: items.length,
      subjectCount: subjects.size,
      latestUpdate: maxIso([
        ...folders.map((f) => f.updated_at),
        ...items.map((m) => m.updated_at),
      ]),
    });
  }

  return cards;
}
