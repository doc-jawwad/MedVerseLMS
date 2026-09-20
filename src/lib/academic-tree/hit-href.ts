import type { AcademicSearchHit, AcademicTreeSurface } from "./types.ts";

/**
 * Map search hits onto the current student hub routes until the class-first
 * `/library` + `/resources` IA is integrated. Never invent content URLs.
 */
export function hrefForAcademicSearchHit(
  hit: Pick<AcademicSearchHit, "kind" | "name" | "path_labels">,
  surface: AcademicTreeSurface
): string {
  const home = surface === "resources" ? "/free-resources" : "/books";

  if (hit.kind === "category") {
    return categoryHubHref(hit.name, surface) ?? home;
  }

  if (hit.kind === "folder" || hit.kind === "day") {
    return surface === "resources" ? "/free-resources" : "/materials";
  }

  // class / block → surface home
  return home;
}

function categoryHubHref(
  name: string,
  surface: AcademicTreeSurface
): string | null {
  const key = name.trim().toLowerCase().replace(/[\s_-]+/g, "");
  const free = surface === "resources";
  const map: Record<string, { paid: string; free: string }> = {
    notes: { paid: "/notes", free: "/free-resources/notes" },
    books: { paid: "/books", free: "/free-resources/books" },
    guidelines: { paid: "/guidelines", free: "/free-resources/guidelines" },
    lectures: { paid: "/lectures", free: "/free-resources/lectures" },
    ospematerial: {
      paid: "/ospe-material",
      free: "/free-resources/ospe-material",
    },
    ospelectures: {
      paid: "/ospe-lectures",
      free: "/free-resources/ospe-lectures",
    },
    pastpapers: { paid: "/books", free: "/free-resources" },
    flashcards: { paid: "/books", free: "/free-resources" },
    test: { paid: "/tests", free: "/tests" },
    mcqbank: { paid: "/mcq-bank", free: "/free-resources/mcq-bank" },
    pearlpoints: {
      paid: "/pearl-points",
      free: "/free-resources/pearl-points",
    },
    ospepractice: {
      paid: "/practice/ospe",
      free: "/practice/ospe",
    },
  };
  const entry = map[key];
  if (!entry) return null;
  return free ? entry.free : entry.paid;
}
