import Link from "next/link";
import { requireAdmin } from "@/lib/auth/require-user";
import { requireAdminClass } from "@/lib/admin/require-admin-class";
import { AdminLibraryTypeTabs } from "@/components/admin/library-type-tabs";
import { MaterialsAdmin } from "../materials/materials-admin";
import { EntitlementSelect } from "@/components/admin/entitlement-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  LIBRARY_LIST,
  parseLibrarySlug,
  yearDisplayName,
  type FolderLibraryType,
  type StudentLibraryType,
} from "@/lib/library/types";

export const metadata = { title: "Free Resources — MedVerse Admin" };

export default async function AdminFreeResourcesPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; type?: string }>;
}) {
  const { supabase } = await requireAdmin();
  const params = await searchParams;
  const parsed = parseLibrarySlug(params.type ?? "mcq-bank") ?? "mcq_bank";
  const type: StudentLibraryType = parsed;

  return requireAdminClass({
    searchYear: params.year,
    next: "/admin/free-resources",
    children: async (year) => {
      if (type === "mcq_bank") {
        const { data: subjects } = await supabase
          .from("subjects")
          .select("id, name, entitlement")
          .eq("year_id", year.id)
          .order("name");
        return (
          <FreeShell yearName={yearDisplayName(year)} type={type}>
            <Card className="shadow-none">
              <CardHeader>
                <CardTitle className="text-base text-[#072855]">
                  Practice subjects
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Mark a subject Free to include it in this class’s Free Resources → MCQ Bank.
                </p>
              </CardHeader>
              <CardContent className="grid gap-2">
                {(subjects ?? []).map((s) => (
                  <Row
                    key={s.id}
                    title={s.name}
                    badge={s.entitlement}
                  >
                    <EntitlementSelect
                      kind="practice_subject"
                      id={s.id}
                      value={s.entitlement}
                    />
                  </Row>
                ))}
                {(subjects ?? []).length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No subjects for this class yet.
                  </p>
                )}
              </CardContent>
            </Card>
          </FreeShell>
        );
      }

      if (type === "pearl_points") {
        const { data: pearls } = await supabase
          .from("pearl_points")
          .select("id, prompt, status, entitlement")
          .eq("year_id", year.id)
          .order("created_at", { ascending: false })
          .limit(200);
        return (
          <FreeShell yearName={yearDisplayName(year)} type={type}>
            <div className="flex justify-end">
              <Button asChild size="sm">
                <Link href="/admin/pearls/new">Add Pearl Point</Link>
              </Button>
            </div>
            <Card className="shadow-none">
              <CardHeader>
                <CardTitle className="text-base text-[#072855]">
                  Pearl Points
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Set entitlement to Free for the curated subset. Publish so students can open them.
                </p>
              </CardHeader>
              <CardContent className="grid gap-2">
                {(pearls ?? []).map((p) => (
                  <Row
                    key={p.id}
                    title={p.prompt}
                    meta={p.status}
                    badge={p.entitlement}
                  >
                    <EntitlementSelect
                      kind="pearl_point"
                      id={p.id}
                      value={p.entitlement}
                    />
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/admin/pearls/${p.id}`}>Edit</Link>
                    </Button>
                  </Row>
                ))}
                {(pearls ?? []).length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No pearl points for this class yet.
                  </p>
                )}
              </CardContent>
            </Card>
          </FreeShell>
        );
      }

      const libraryType = type as FolderLibraryType;
      const [{ data: years }, { data: subjects }, { data: folders }, { data: materials }] =
        await Promise.all([
          supabase.from("years").select("id, year_number, name").order("year_number"),
          supabase
            .from("subjects")
            .select("id, name, year_id")
            .eq("year_id", year.id)
            .order("name"),
          supabase
            .from("material_folders")
            .select("id, name, year_id, subject_id, entitlement, library_type")
            .eq("year_id", year.id)
            .eq("library_type", libraryType)
            .order("sort_order")
            .order("name"),
          supabase
            .from("materials")
            .select("id, folder_id, title, description, file_type, kind, status")
            .order("sort_order")
            .order("title"),
        ]);

      return (
        <FreeShell yearName={yearDisplayName(year)} type={type}>
          <p className="text-sm text-muted-foreground">
            Create or mark folders as Free for this type. Items stay in the same folder used by the
            full library.
          </p>
          <MaterialsAdmin
            years={years ?? []}
            subjects={subjects ?? []}
            folders={folders ?? []}
            materials={materials ?? []}
            lockedYearId={year.id}
            libraryType={libraryType}
            defaultEntitlement="free"
          />
        </FreeShell>
      );
    },
  });
}

function FreeShell({
  yearName,
  type,
  children,
}: {
  yearName: string;
  type: StudentLibraryType;
  children: React.ReactNode;
}) {
  const slug = LIBRARY_LIST.find((t) => t.id === type)?.slug ?? "mcq-bank";
  return (
    <div className="grid gap-6">
      <div>
        <p className="text-[11px] font-semibold tracking-[0.16em] text-primary uppercase">
          {yearName} · Free Resources
        </p>
        <h1 className="font-heading text-2xl font-semibold text-[#072855]">
          Free Resources
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Curation over existing content — not a second library. Only published Free items appear
          to students in this class’s Free Resources.
        </p>
      </div>
      <AdminLibraryTypeTabs basePath="/admin/free-resources" active={slug} />
      {children}
    </div>
  );
}

function Row({
  title,
  meta,
  badge,
  children,
}: {
  title: string;
  meta?: string;
  badge: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
      <div className="min-w-0">
        <p className="font-medium text-[#072855]">{title}</p>
        {meta && <p className="text-xs text-muted-foreground">{meta}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={badge === "free" ? "secondary" : "outline"}>{badge}</Badge>
        {children}
      </div>
    </div>
  );
}
