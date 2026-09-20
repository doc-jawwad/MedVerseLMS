import type { IconKey } from "@/components/mobile-nav";

export const FOLDER_LIBRARY_TYPES = [
  "guidelines",
  "ospe_material",
  "ospe_lectures",
  "books",
  "notes",
  "lectures",
] as const;

export type FolderLibraryType = (typeof FOLDER_LIBRARY_TYPES)[number];

export const STUDENT_LIBRARY_TYPES = [
  "mcq_bank",
  "pearl_points",
  ...FOLDER_LIBRARY_TYPES,
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
  pearl_points: {
    id: "pearl_points",
    slug: "pearl-points",
    label: "Pearl Points",
    href: "/pearl-points",
    freeHref: "/free-resources/pearl-points",
    icon: "pearlPoints",
    description: "High-yield recall points. Not scored exams.",
    folderType: null,
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

export function parseLibrarySlug(slug: string): StudentLibraryType | null {
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
  "/materials",
  "/free-resources",
  "/resources",
  "/library",
  "/mcq-bank",
  "/pearl-points",
  "/practice/ospe",
  "/guidelines",
  "/ospe-material",
  "/ospe-lectures",
  "/books",
  "/notes",
  "/lectures",
] as const;
