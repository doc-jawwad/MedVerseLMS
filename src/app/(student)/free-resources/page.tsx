import Link from "next/link";
import { requireStudent } from "@/lib/auth/require-user";
import { getStudentHasLiveSubscription } from "@/lib/subscriptions/student-live-access";
import { OpenMaterialButton } from "@/components/materials/open-material-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/student/page-header";
import { StudentPage } from "@/components/student/student-page";
import { EmptyState } from "@/components/student/empty-state";
import { SectionHeading } from "@/components/student/section-heading";

export const metadata = { title: "Free Resources — MedVerse LMS" };

type PracticeSubject = {
  subject_id: string;
  subject_name: string;
  approved_questions: number;
  granted: boolean;
};

/**
 * Free Resources — presents items the student can use without a live
 * subscription: entitlement=free and/or live grants (existing model).
 * Does not invent a parallel entitlement system or duplicate storage.
 */
export default async function FreeResourcesPage() {
  const { supabase } = await requireStudent();
  const hasLiveAccess = await getStudentHasLiveSubscription();

  const [
    { data: practiceRows },
    { data: folders },
    { data: materials },
    { data: accessibleFolders },
    { data: catalogTests },
    { data: accessibleTests },
  ] = await Promise.all([
    supabase.rpc("practice_subjects"),
    supabase
      .from("material_folders")
      .select("id, name, subject_id")
      .order("sort_order")
      .order("name"),
    supabase
      .from("materials")
      .select("id, folder_id, title, description, file_type")
      .order("sort_order")
      .order("title"),
    supabase.rpc("accessible_folder_ids"),
    supabase
      .from("tests")
      .select("id, title, status, entitlement, subjects(name), question_count")
      .in("status", ["published", "closed"])
      .order("title"),
    supabase.rpc("accessible_test_ids"),
  ]);

  const accessibleFolderSet = new Set(
    (accessibleFolders ?? []).map((row: { id: string }) => row.id)
  );
  const accessibleTestSet = new Set(
    (accessibleTests ?? []).map((row: { id: string }) => row.id)
  );

  const freePractice = ((practiceRows ?? []) as PracticeSubject[]).filter(
    (s) => s.granted
  );

  const freeFolders = (folders ?? []).filter((f) =>
    accessibleFolderSet.has(f.id)
  );

  const freeTests = (catalogTests ?? []).filter((t) =>
    accessibleTestSet.has(t.id)
  );

  const empty =
    freePractice.length === 0 &&
    freeFolders.length === 0 &&
    freeTests.length === 0;

  return (
    <StudentPage>
      <PageHeader
        title="Free Resources"
        description={
          hasLiveAccess
            ? "Educational items you can use without an extra grant. Subscribed sections stay in Study Materials, Practice, Tests, and Performance."
            : "Use these without a subscription. Study Materials, Practice, Tests, and Performance unlock when your subscription is live."
        }
        actions={
          !hasLiveAccess ? (
            <Button asChild size="sm" variant="secondary">
              <Link href="/subscription">Get Subscription</Link>
            </Button>
          ) : null
        }
      />

      {empty && (
        <EmptyState
          title="No free resources for your year yet"
          description="When your academy publishes free materials, practice banks, or tests, they appear here."
        />
      )}

      {freePractice.length > 0 && (
        <div className="grid gap-3">
          <SectionHeading
            title="Practice"
            description="Subjects you can practice now (free entitlement or personal grant)."
          />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {freePractice.map((s) => (
              <Link key={s.subject_id} href={`/practice/${s.subject_id}`}>
                <Card className="h-full shadow-none transition-colors hover:bg-accent/40">
                  <CardHeader>
                    <CardTitle className="text-lg text-[#072855]">
                      {s.subject_name}
                    </CardTitle>
                    <CardDescription>
                      {s.approved_questions} questions available
                    </CardDescription>
                  </CardHeader>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}

      {freeTests.length > 0 && (
        <div className="grid gap-3">
          <SectionHeading
            title="Tests"
            description="Tests you can open now under free entitlement or a personal grant."
          />
          <div className="grid gap-3">
            {freeTests.map((t) => {
              const subj = t.subjects as unknown as { name: string } | null;
              return (
                <Card key={t.id} className="shadow-none">
                  <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
                    <div>
                      <CardTitle className="text-base text-[#072855]">
                        {t.title}
                      </CardTitle>
                      <CardDescription>
                        {subj?.name ? `${subj.name} · ` : ""}
                        {t.question_count ?? "—"} MCQs
                        {t.entitlement === "free" ? " · Free" : " · Granted"}
                      </CardDescription>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{t.status}</Badge>
                      {t.status === "published" ? (
                        <Button asChild size="sm">
                          <Link href={`/tests/${t.id}/attempt`}>Open</Link>
                        </Button>
                      ) : (
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/tests/${t.id}/result`}>Result</Link>
                        </Button>
                      )}
                    </div>
                  </CardHeader>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {freeFolders.length > 0 && (
        <div className="grid gap-3">
          <SectionHeading
            title="Materials"
            description="Folders you can open now (free entitlement or personal grant)."
          />
          {freeFolders.map((f) => {
            const items = (materials ?? []).filter((m) => m.folder_id === f.id);
            return (
              <Card key={f.id} className="shadow-none">
                <CardHeader>
                  <CardTitle className="text-base text-[#072855]">
                    {f.name}
                  </CardTitle>
                  {items.length === 0 && (
                    <CardDescription>Nothing here yet.</CardDescription>
                  )}
                </CardHeader>
                {items.length > 0 && (
                  <CardContent className="grid gap-3">
                    {items.map((m) => (
                      <div
                        key={m.id}
                        className="flex items-center justify-between rounded-xl border p-3 text-sm transition-colors hover:bg-accent/50"
                      >
                        <div>
                          <OpenMaterialButton
                            materialId={m.id}
                            className="h-auto p-0 font-medium"
                          >
                            {m.title}
                          </OpenMaterialButton>
                          {m.description && (
                            <p className="text-xs text-muted-foreground">
                              {m.description}
                            </p>
                          )}
                        </div>
                        <Badge variant="secondary" className="uppercase">
                          {m.file_type}
                        </Badge>
                      </div>
                    ))}
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </StudentPage>
  );
}
