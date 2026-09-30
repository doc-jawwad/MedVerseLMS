import type { IconKey } from "@/components/mobile-nav";

export const FOLDER_LIBRARY_TYPES = [
  "guidelines",
  "los",
  "ospe_material",
  "ospe_lectures",
  "ospe_past",
  "books",
  "notes",
  "lectures",
  "syllabus",
  "schedule",
  "past_papers",
  "flashcards",
  "other_services",
  "career_counseling_series",
  "one_liner",
] as const;

export type FolderLibraryType = (typeof FOLDER_LIBRARY_TYPES)[number];

/** Student top-level library nav (excludes Prof. Session–only folder types). */
export const STUDENT_LIBRARY_TYPES = [
  "mcq_bank",
  "one_liner",
  "guidelines",
  "ospe_material",
  "ospe_lectures",
  "books",
  "notes",
  "lectures",
] as const;

export type StudentLibraryType = (typeof STUDENT_LIBRARY_TYPES)[number];

export type LibraryMeta = {
  id: StudentLibraryType;
  slug: string;
  label: string;
  href: string;
  freeHref: string;
  icon: IconKey;
  description: string;
  folderType: FolderLibraryType | null;
};

export const LIBRARY_META: Record<StudentLibraryType, LibraryMeta> = {
  mcq_bank: {
    id: "mcq_bank",
    slug: "mcq-bank",
    label: "MCQ Bank",
    href: "/mcq-bank",
    freeHref: "/free-resources/mcq-bank",
    icon: "practice",
    description: "Practice questions with instant feedback.",
    folderType: null,
  },
  one_liner: {
    id: "one_liner",
    slug: "one-liner",
    label: "One Liner",
    href: "/one-liner",
    freeHref: "/free-resources/one-liner",
    icon: "pearlPoints",
    description: "High-yield PDF folders — open, read, and highlight.",
    folderType: "one_liner",
  },
  guidelines: {
    id: "guidelines",
    slug: "guidelines",
    label: "Guidelines",
    href: "/guidelines",
    freeHref: "/free-resources/guidelines",
    icon: "guidelines",
    description: "Study guides and structured text.",
    folderType: "guidelines",
  },
  ospe_material: {
    id: "ospe_material",
    slug: "ospe-material",
    label: "OSPE Material",
    href: "/ospe-material",
    freeHref: "/free-resources/ospe-material",
    icon: "ospeMaterial",
    description: "OSPE PDFs and station packs.",
    folderType: "ospe_material",
  },
  ospe_lectures: {
    id: "ospe_lectures",
    slug: "ospe-lectures",
    label: "OSPE Lectures",
    href: "/ospe-lectures",
    freeHref: "/free-resources/ospe-lectures",
    icon: "ospeLectures",
    description: "OSPE lecture videos and Drive recordings.",
    folderType: "ospe_lectures",
  },
  books: {
    id: "books",
    slug: "books",
    label: "Books",
    href: "/books",
    freeHref: "/free-resources/books",
    icon: "books",
    description: "Reference books and complete texts.",
    folderType: "books",
  },
  notes: {
    id: "notes",
    slug: "notes",
    label: "Notes",
    href: "/notes",
    freeHref: "/free-resources/notes",
    icon: "notes",
    description: "Class notes and concise write-ups.",
    folderType: "notes",
  },
  lectures: {
    id: "lectures",
    slug: "lectures",
    label: "Lectures",
    href: "/lectures",
    freeHref: "/free-resources/lectures",
    icon: "lectures",
    description: "Lecture videos (YouTube or Drive).",
    folderType: "lectures",
  },
};

export const LIBRARY_LIST: LibraryMeta[] = STUDENT_LIBRARY_TYPES.map(
  (id) => LIBRARY_META[id]
);

export function isFolderLibraryType(value: string): value is FolderLibraryType {
  return (FOLDER_LIBRARY_TYPES as readonly string[]).includes(value);
}

/** Labels for any material folder type (including Prof. Session–only). */
export function folderLibraryLabel(type: FolderLibraryType): {
  label: string;
  description: string;
} {
  switch (type) {
    case "syllabus":
      return {
        label: "Syllabus",
        description: "Block syllabus PDF.",
      };
    case "schedule":
      return {
        label: "Schedule",
        description: "Block schedule materials.",
      };
    case "los":
      return {
        label: "LoS",
        description: "Learning outcomes.",
      };
    case "ospe_past":
      return {
        label: "Past OSPE",
        description: "Past OSPE PDFs and pictures.",
      };
    case "past_papers":
      return {
        label: "Past Papers",
        description: "Exam past papers organized by category.",
      };
    case "other_services":
      return {
        label: "Other Services",
        description: "Academy services and external resources.",
      };
    case "career_counseling_series":
      return {
        label: "Career Counseling Series",
        description: "Career guidance folders and protected PDFs.",
      };
    case "flashcards":
      return {
        label: "Flashcards",
        description: "Placeholder category — no flashcard engine yet.",
      };
    case "one_liner":
      return {
        label: "One Liner",
        description: "High-yield PDF folders — open, read, and highlight.",
      };
    default: {
      const meta = LIBRARY_META[type as StudentLibraryType];
      return {
        label: meta?.label ?? type,
        description: meta?.description ?? "",
      };
    }
  }
}

export function parseLibrarySlug(slug: string): StudentLibraryType | null {
  // Legacy Pearl Points slug kept so old free-resource bookmarks still resolve.
  if (slug === "pearl-points") return "one_liner";
  const found = LIBRARY_LIST.find((m) => m.slug === slug);
  return found?.id ?? null;
}

export function yearDisplayName(year: {
  year_number: number;
  name?: string | null;
}): string {
  const name = year.name?.trim();
  if (name) return name;
  const n = year.year_number;
  const ordinal =
    n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : n === 5 ? "Final" : `${n}th`;
  return n === 5 ? "Final Year MBBS" : `${ordinal} Year MBBS`;
}

export function itemDeliveryModes(type: FolderLibraryType): Array<
  "pdf" | "guideline" | "drive"
> {
  switch (type) {
    case "guidelines":
      return ["guideline", "pdf"];
    case "ospe_lectures":
    case "lectures":
      return ["drive"];
    case "past_papers":
      return ["pdf"];
    case "syllabus":
    case "notes":
    case "one_liner":
      return ["pdf"];
    case "other_services":
      return ["drive"];
    case "career_counseling_series":
      return ["pdf"];
    default:
      return ["pdf", "drive"];
  }
}

export const STUDY_REVALIDATE_PATHS = [
  "/admin/materials",
  "/admin/free-resources",
  "/admin/library",
  "/admin/pearls",
  "/admin/ospe-stations",
  "/admin/past-papers",
  "/admin/other-services",
  "/admin/career-counseling-series",
  "/materials",
  "/free-resources",
  "/resources",
  "/library",
  "/academic",
  "/mcq-bank",
  "/one-liner",
  "/pearl-points",
  "/practice/ospe",
  "/guidelines",
  "/ospe-material",
  "/ospe-lectures",
  "/books",
  "/notes",
  "/lectures",
  "/past-papers",
  "/other-services",
  "/career-counseling-series",
] as const;
