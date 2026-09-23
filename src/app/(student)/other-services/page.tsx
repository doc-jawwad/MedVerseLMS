import { requireStudent } from "@/lib/auth/require-user";
import { SectionLock } from "@/components/subscription/section-lock";
import { PageHeader } from "@/components/student/page-header";
import { StudentPage } from "@/components/student/student-page";
import { EmptyState } from "@/components/student/empty-state";
import { ResourceLockNotice } from "@/components/subscription/resource-lock-notice";
import { OpenMaterialButton } from "@/components/materials/open-material-button";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getStudentHasLiveSubscription } from "@/lib/subscriptions/student-live-access";
import { studentHasPaidLmsSections } from "@/lib/subscriptions/student-section-access";

export const metadata = { title: "Other Services — MedVerse LMS" };

type ServiceFolder = {
  id: string;
  name: string;
  description: string | null;
  entitlement: string;
};

type DriveMaterial = {
  id: string;
  folder_id: string;
  title: string;
  kind: string;
};

export default async function OtherServicesPage() {
  const { supabase, enrollment } = await requireStudent();
  const hasLiveAccess = await getStudentHasLiveSubscription();

  if (!studentHasPaidLmsSections(hasLiveAccess)) {
    return (
      <SectionLock
        title="Other Services"
        description="Other Services unlock with a live subscription."
      />
    );
  }

  const [{ data: folders }, { data: materials }, { data: accessible }] =
    await Promise.all([
      supabase
        .from("material_folders")
        .select("id, name, description, entitlement")
        .eq("library_type", "other_services")
        .eq("year_id", enrollment.year_id)
        .is("deleted_at", null)
        .is("parent_id", null)
        .order("sort_order")
        .order("name"),
      supabase
        .from("materials")
        .select("id, folder_id, title, kind")
        .eq("kind", "drive")
        .is("deleted_at", null)
        .order("sort_order")
        .order("title"),
      supabase.rpc("accessible_folder_ids"),
    ]);

  const entitled = new Set(
    (accessible ?? []).map((row: { id: string }) => row.id)
  );
  const services = (folders ?? []) as ServiceFolder[];
  const links = (materials ?? []) as DriveMaterial[];

  return (
    <StudentPage>
      <PageHeader
        eyebrow="Study"
        title="Other Services"
        description="Academy services and external resources for your class."
      />

      {services.length === 0 ? (
        <EmptyState
          title="No other services yet"
          description="When your academy publishes services here, they appear as cards with an optional Drive link."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {services.map((service) => {
            const locked = !entitled.has(service.id);
            const drive = links.find((m) => m.folder_id === service.id);
            return (
              <Card
                key={service.id}
                className={`shadow-none ${locked ? "opacity-95" : ""}`}
              >
                <CardHeader>
                  <CardTitle className="text-lg text-[var(--student-ink)]">
                    {service.name}
                  </CardTitle>
                  {service.description ? (
                    <CardDescription>{service.description}</CardDescription>
                  ) : null}
                </CardHeader>
                <CardContent className="grid gap-3">
                  {locked ? (
                    <ResourceLockNotice />
                  ) : drive ? (
                    <OpenMaterialButton materialId={drive.id}>
                      Open Drive link
                    </OpenMaterialButton>
                  ) : (
                    <Button variant="outline" size="sm" disabled className="w-fit">
                      No link yet
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </StudentPage>
  );
}
