import Link from "next/link";
import { requireAdminClass } from "@/lib/admin/require-admin-class";
import { yearDisplayName, LIBRARY_LIST } from "@/lib/library/types";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getAdminPermissionSet, adminHasAny } from "@/lib/admin/admin-nav";

export const metadata = { title: "Class library — MedVerse Admin" };

export default async function AdminLibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const params = await searchParams;
  const perms = await getAdminPermissionSet();
  const canMaterials = adminHasAny(perms, ["manage_materials"]);
  const canQuestions = adminHasAny(perms, ["edit_questions", "import_questions"]);
  const canTests = adminHasAny(perms, ["publish_tests", "view_analytics"]);
  const canFree = adminHasAny(perms, [
    "manage_materials",
    "grant_resource_access",
    "publish_tests",
  ]);

  return requireAdminClass({
    searchYear: params.year,
    next: "/admin/library",
    children: (year) => (
      <div className="grid gap-6">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.16em] text-primary uppercase">
            {yearDisplayName(year)}
          </p>
          <h1 className="font-heading text-2xl font-semibold text-[#072855]">
            Class library
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Free Resources is a curated subset. The full library uses the same records
            with access policy, not a second copy.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {canFree && (
            <Link href="/admin/free-resources">
              <Card className="h-full shadow-none transition-colors hover:bg-accent/40">
                <CardHeader>
                  <CardTitle className="text-lg text-[#072855]">
                    Free Resources
                  </CardTitle>
                  <CardDescription>
                    Curate which items this class can use without a subscription.
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
          )}
          {canMaterials && (
            <Link href="/admin/materials">
              <Card className="h-full shadow-none transition-colors hover:bg-accent/40">
                <CardHeader>
                  <CardTitle className="text-lg text-[#072855]">
                    Full library / paid resources
                  </CardTitle>
                  <CardDescription>
                    Guidelines, OSPE, books, notes, and lectures for this class.
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
          )}
          {canQuestions && (
            <Link href={`/admin/questions?year=${year.id}`}>
              <Card className="h-full shadow-none transition-colors hover:bg-accent/40">
                <CardHeader>
                  <CardTitle className="text-lg text-[#072855]">
                    Question Bank
                  </CardTitle>
                  <CardDescription>
                    MCQs for {yearDisplayName(year)}, organized by subject and topic.
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
          )}
          {canMaterials && (
            <Link href={`/admin/pearls?year=${year.id}`}>
              <Card className="h-full shadow-none transition-colors hover:bg-accent/40">
                <CardHeader>
                  <CardTitle className="text-lg text-[#072855]">
                    Pearl Points
                  </CardTitle>
                  <CardDescription>
                    Recall items for this class. Access policy marks free vs paid.
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
          )}
          {canTests && (
            <Link href="/admin/tests">
              <Card className="h-full shadow-none transition-colors hover:bg-accent/40">
                <CardHeader>
                  <CardTitle className="text-lg text-[#072855]">Tests</CardTitle>
                  <CardDescription>
                    Scheduled assessments for {yearDisplayName(year)}.
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
          )}
        </div>

        {canMaterials && (
          <div>
            <h2 className="mb-3 font-heading text-base font-semibold text-[#072855]">
              Full library types
            </h2>
            <div className="flex flex-wrap gap-2">
              {LIBRARY_LIST.filter((t) => t.folderType).map((t) => (
                <Link
                  key={t.id}
                  href={`/admin/materials?type=${t.slug}`}
                  className="rounded-full border bg-card px-3 py-1 text-sm hover:bg-accent"
                >
                  {t.label}
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    ),
  });
}
