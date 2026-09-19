import { requireStudent } from "@/lib/auth/require-user";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { OpenMaterialButton } from "@/components/materials/open-material-button";
import { ResourceLockNotice } from "@/components/subscription/resource-lock-notice";
import { SectionLock } from "@/components/subscription/section-lock";
import { PageHeader } from "@/components/student/page-header";
import { StudentPage } from "@/components/student/student-page";
import { EmptyState } from "@/components/student/empty-state";
import { getStudentHasLiveSubscription } from "@/lib/subscriptions/student-live-access";
import { studentHasPaidLmsSections } from "@/lib/subscriptions/student-section-access";

export const metadata = { title: "Study Materials — MedVerse LMS" };

export default async function MaterialsPage() {
  const { supabase } = await requireStudent();
  const hasLiveAccess = await getStudentHasLiveSubscription();
  if (!studentHasPaidLmsSections(hasLiveAccess)) {
    return (
      <SectionLock
        title="Study Materials"
        description="The full materials library unlocks with a live subscription. Free folders stay under Free Resources."
      />
    );
  }

  const [{ data: folders }, { data: materials }, { data: subjects }, { data: accessible }] =
    await Promise.all([
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
      supabase.from("subjects").select("id, name"),
      supabase.rpc("accessible_folder_ids"),
    ]);

  const entitled = new Set(
    (accessible ?? []).map((row: { id: string }) => row.id)
  );
  const subjectName = (id: string | null) =>
    subjects?.find((s) => s.id === id)?.name;

  return (
    <StudentPage>
      <PageHeader
        title="Study Materials"
        description="Links open in Google Drive — download from there."
      />

      {(folders ?? []).map((f) => {
        const items = (materials ?? []).filter((m) => m.folder_id === f.id);
        const locked = !entitled.has(f.id);
        return (
          <Card key={f.id} className={`shadow-none ${locked ? "opacity-95" : ""}`}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2 text-base text-[#072855]">
                {f.name}{" "}
                {f.subject_id && (
                  <Badge variant="outline">{subjectName(f.subject_id)}</Badge>
                )}
              </CardTitle>
              {!locked && items.length === 0 && (
                <CardDescription>Nothing here yet.</CardDescription>
              )}
            </CardHeader>
            {(locked || items.length > 0) && (
              <CardContent className="grid gap-3">
                {locked && <ResourceLockNotice />}
                {items.map((m) => (
                  <div
                    key={m.id}
                    className={`flex items-center justify-between rounded-xl border p-3 text-sm ${
                      locked
                        ? "opacity-70"
                        : "transition-colors hover:bg-accent/50"
                    }`}
                  >
                    <div>
                      {locked ? (
                        <span className="font-medium">{m.title}</span>
                      ) : (
                        <OpenMaterialButton
                          materialId={m.id}
                          className="h-auto p-0 font-medium"
                        >
                          {m.title}
                        </OpenMaterialButton>
                      )}
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

      {(folders ?? []).length === 0 && (
        <EmptyState
          title="No study materials for your year yet"
          description="Free and subscribed folders will appear here when your academy publishes them."
        />
      )}
    </StudentPage>
  );
}
