import Link from "next/link";
import { requireStudent } from "@/lib/auth/require-user";
import { getStudentHasLiveSubscription } from "@/lib/subscriptions/student-live-access";
import { buildFreeResourceCategories } from "@/lib/library/free-categories";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/student/page-header";
import { StudentPage } from "@/components/student/student-page";
import { EmptyState } from "@/components/student/empty-state";

export const metadata = { title: "Free Resources — MedVerse LMS" };

type PracticeSubject = {
  subject_id: string;
  granted: boolean;
  approved_questions: number;
};

export default async function FreeResourcesPage() {
  const { supabase } = await requireStudent();
  const hasLiveAccess = await getStudentHasLiveSubscription();

  const [
    { data: practiceRows },
    { data: folders },
    { data: materials },
    { data: accessibleFolders },
    { data: pearls },
    { data: accessiblePearls },
  ] = await Promise.all([
    supabase.rpc("practice_subjects"),
    supabase
      .from("material_folders")
      .select("id, library_type, subject_id, updated_at")
      .order("name"),
    supabase.from("materials").select("folder_id, updated_at"),
    supabase.rpc("accessible_folder_ids"),
    supabase
      .from("pearl_points")
      .select("id, subject_id, updated_at")
      .eq("status", "published"),
    supabase.rpc("accessible_pearl_ids"),
  ]);

  const categories = buildFreeResourceCategories({
    practice: (practiceRows ?? []) as PracticeSubject[],
    folders: folders ?? [],
    accessibleFolderIds: (accessibleFolders ?? []).map(
      (row: { id: string }) => row.id
    ),
    materials: materials ?? [],
    pearls: pearls ?? [],
    accessiblePearlIds: (accessiblePearls ?? []).map(
      (row: { id: string }) => row.id
    ),
  });

  return (
    <StudentPage>
      <PageHeader
        title="Free Resources"
        description={
          hasLiveAccess
            ? "The curated free subset for your class. Your full library stays in the main sections."
            : "Only categories your academy has published as free for your class. The full library unlocks with a subscription."
        }
        actions={
          !hasLiveAccess ? (
            <Button asChild size="sm" variant="secondary">
              <Link href="/subscription">Get Subscription</Link>
            </Button>
          ) : null
        }
      />

      {categories.length === 0 ? (
        <EmptyState
          title="No free resources for your class yet"
          description="When your academy publishes free MCQs, pearl points, or materials, those categories appear here. Empty categories are hidden."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {categories.map((cat) => (
              <Link key={cat.id} href={cat.href}>
                <Card className="h-full shadow-none transition-colors hover:bg-accent/40">
                  <CardHeader>
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle className="text-lg text-[#072855]">
                        {cat.label}
                      </CardTitle>
                      <Badge variant="secondary">{cat.itemCount} items</Badge>
                    </div>
                    <CardDescription>{cat.description}</CardDescription>
                    <p className="text-xs text-muted-foreground">
                      {cat.subjectCount}{" "}
                      {cat.subjectCount === 1 ? "subject" : "subjects"}
                      {cat.latestUpdate
                        ? ` · updated ${new Date(cat.latestUpdate).toLocaleDateString()}`
                        : ""}
                    </p>
                  </CardHeader>
                </Card>
              </Link>
          ))}
        </div>
      )}
    </StudentPage>
  );
}
