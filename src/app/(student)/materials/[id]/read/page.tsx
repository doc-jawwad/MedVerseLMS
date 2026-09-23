import { notFound } from "next/navigation";
import { requireStudent } from "@/lib/auth/require-user";
import { PdfViewer } from "@/components/study/pdf-viewer";
import { StudyMarkdown } from "@/components/study/study-markdown";
import { ResourceLockNotice } from "@/components/subscription/resource-lock-notice";
import { PageHeader } from "@/components/student/page-header";
import { StudentPage } from "@/components/student/student-page";
import {
  Card,
  CardContent,
} from "@/components/ui/card";

export const metadata = { title: "Study item — MedVerse LMS" };

export default async function StudyReadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { supabase, profile } = await requireStudent();
  const { id } = await params;

  const { data: catalog } = await supabase
    .from("materials")
    .select("id, title, description, kind, status, reference_text")
    .eq("id", id)
    .maybeSingle();
  if (!catalog) notFound();

  const { data: bio } = await supabase
    .from("profiles")
    .select("college_name")
    .eq("id", profile.id)
    .maybeSingle();

  const { data, error } = await supabase.rpc("open_study_item", {
    p_material_id: id,
  });

  if (error || !data) {
    return (
      <StudentPage width="narrow">
        <PageHeader title={catalog.title} description={catalog.description || undefined} />
        <ResourceLockNotice />
      </StudentPage>
    );
  }

  const item = data as {
    kind: string;
    title: string;
    description: string;
    reference_text: string;
    body_text: string | null;
    has_pdf: boolean;
  };

  return (
    <StudentPage width="article">
      <PageHeader
        title={item.title}
        description={item.description || undefined}
      />
      {item.reference_text ? (
        <p className="text-sm text-muted-foreground">Reference: {item.reference_text}</p>
      ) : null}
      {item.kind === "guideline" && (
        <Card className="shadow-none">
          <CardContent className="pt-6">
            <StudyMarkdown source={item.body_text ?? ""} />
          </CardContent>
        </Card>
      )}
      {item.kind === "pdf" && item.has_pdf && (
        <PdfViewer
          materialId={id}
          title={item.title}
          watermarkName={profile.full_name}
          watermarkCollege={
            typeof bio?.college_name === "string" ? bio.college_name : undefined
          }
        />
      )}
    </StudentPage>
  );
}
