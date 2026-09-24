import { requireStudent } from "@/lib/auth/require-user";
import { PageHeader } from "@/components/student/page-header";
import { StudentPage } from "@/components/student/student-page";
import { EmptyState } from "@/components/student/empty-state";
import { ResourceLockNotice } from "@/components/subscription/resource-lock-notice";
import { OpenMaterialButton } from "@/components/materials/open-material-button";
import { MaterialOpenLink } from "@/components/study/material-open-link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata = { title: "Other Services — MedVerse LMS" };

type ServiceFolder = {
  id: string;
  name: string;
  description: string | null;
  entitlement: string;
};

type ServiceMaterial = {
  id: string;
  folder_id: string;
  title: string;
  kind: string;
  status: string;
};

export default async function OtherServicesPage() {
  const { supabase, enrollment } = await requireStudent();

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
        .select("id, folder_id, title, kind, status")
        .in("kind", ["drive", "pdf"])
        .is("deleted_at", null)
        .order("sort_order")
        .order("title"),
      supabase.rpc("accessible_folder_ids"),
    ]);

  const entitled = new Set(
    (accessible ?? []).map((row: { id: string }) => row.id)
  );
  const services = (folders ?? []) as ServiceFolder[];
  const mats = ((materials ?? []) as ServiceMaterial[]).filter(
    (m) => m.kind === "drive" || m.status === "published"
  );

  return (
    <StudentPage>
      <PageHeader
        eyebrow="Study"
        title="Other Services"
        description="Academy services and resources for your class. Open without a paid subscription; each service still respects its own access setting."
      />

      {services.length === 0 ? (
        <EmptyState
          title="No other services yet"
          description="When your academy publishes services here, they appear as cards with an optional PDF or Drive link."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {services.map((service) => {
            const locked = !entitled.has(service.id);
            const serviceMats = mats.filter((m) => m.folder_id === service.id);
            const pdfs = serviceMats.filter((m) => m.kind === "pdf");
            const drives = serviceMats.filter((m) => m.kind === "drive");
            return (
              <Card
                key={service.id}
                className={`shadow-none ${locked ? "opacity-95" : ""}`}
                data-testid={`other-service-${service.id}`}
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
                  ) : pdfs.length === 0 && drives.length === 0 ? (
                    <Button variant="outline" size="sm" disabled className="w-fit">
                      Content coming soon
                    </Button>
                  ) : (
                    <div className="grid gap-2">
                      {pdfs.map((m) => (
                        <MaterialOpenLink
                          key={m.id}
                          materialId={m.id}
                          kind="pdf"
                          title={m.title}
                          className="h-auto justify-start p-0 font-medium"
                        />
                      ))}
                      {drives.map((m) => (
                        <OpenMaterialButton
                          key={m.id}
                          materialId={m.id}
                          className="h-auto justify-start p-0 font-medium"
                        >
                          {m.title || "Open Drive link"}
                        </OpenMaterialButton>
                      ))}
                    </div>
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
