import { requireAdmin } from "@/lib/auth/require-user";
import { MaterialsAdmin } from "./materials-admin";
import { requireAdminClass } from "@/lib/admin/require-admin-class";
import { AdminLibraryTypeTabs } from "@/components/admin/library-type-tabs";
import {
  LIBRARY_LIST,
  LIBRARY_META,
  isFolderLibraryType,
  parseLibrarySlug,
  yearDisplayName,
  type FolderLibraryType,
} from "@/lib/library/types";

export const metadata = { title: "Full library — MedVerse Admin" };

function resolveMaterialsLibraryType(typeParam?: string): {
  libraryType: FolderLibraryType;
  activeSlug: string;
} {
  if (!typeParam) {
    return { libraryType: "notes", activeSlug: "notes" };
  }
  const asFolder = typeParam.replace(/-/g, "_");
  if (isFolderLibraryType(asFolder)) {
    return {
      libraryType: asFolder,
      activeSlug: typeParam,
    };
  }
  const parsed = parseLibrarySlug(typeParam);
  const folderType =
    parsed && LIBRARY_META[parsed].folderType
      ? LIBRARY_META[parsed].folderType
      : null;
  if (folderType) {
    return {
      libraryType: folderType,
      activeSlug:
        LIBRARY_LIST.find((t) => t.id === parsed)?.slug ?? typeParam,
    };
  }
  return { libraryType: "notes", activeSlug: "notes" };
}

export default async function AdminMaterialsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; type?: string }>;
}) {
  const { supabase } = await requireAdmin();
  const params = await searchParams;
  const { libraryType, activeSlug } = resolveMaterialsLibraryType(params.type);

  const [{ data: years }, { data: subjects }, { data: folders }, { data: materials }] =
    await Promise.all([
      supabase.from("years").select("id, year_number, name").order("year_number"),
      supabase.from("subjects").select("id, name, year_id").order("name"),
      supabase
        .from("material_folders")
        .select("id, name, year_id, subject_id, entitlement, library_type")
        .is("deleted_at", null)
        .order("sort_order")
        .order("name"),
      supabase
        .from("materials")
        .select("id, folder_id, title, description, file_type, kind, status")
        .is("deleted_at", null)
        .order("sort_order")
        .order("title"),
    ]);

  return requireAdminClass({
    searchYear: params.year,
    next: "/admin/materials",
    children: (year) => (
      <div className="grid gap-6">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.16em] text-primary uppercase">
            {yearDisplayName(year)} · Full library
          </p>
          <h1 className="font-heading text-2xl font-semibold text-[var(--student-ink)]">
            Paid / full resources
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Same records as Free Resources. Set access to Free or subscription-required.
            Folders group subject → topic → items. New folders default to subscription-required.
          </p>
        </div>
        <AdminLibraryTypeTabs
          basePath="/admin/materials"
          active={activeSlug}
          extras={[
            { slug: "los", label: "LoS" },
            { slug: "syllabus", label: "Syllabus" },
            { slug: "schedule", label: "Schedule" },
          ]}
        />
        <MaterialsAdmin
          years={years ?? []}
          subjects={(subjects ?? []).filter((s) => s.year_id === year.id)}
          folders={(folders ?? []).filter((f) => f.year_id === year.id)}
          materials={materials ?? []}
          lockedYearId={year.id}
          libraryType={libraryType}
          defaultEntitlement="any_subscription"
        />
      </div>
    ),
  });
}
