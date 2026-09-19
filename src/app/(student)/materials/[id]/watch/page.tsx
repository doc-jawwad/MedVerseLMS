import { notFound, redirect } from "next/navigation";
import { requireStudent } from "@/lib/auth/require-user";
import { PageHeader } from "@/components/student/page-header";
import { StudentPage } from "@/components/student/student-page";
import { ResourceLockNotice } from "@/components/subscription/resource-lock-notice";
import { youtubeEmbedSrc } from "@/lib/library/media-url";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Lecture — MedVerse LMS" };

export default async function MaterialWatchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { supabase } = await requireStudent();
  const { id } = await params;

  const { data: catalog } = await supabase
    .from("materials")
    .select("id, title, description, kind")
    .eq("id", id)
    .maybeSingle();
  if (!catalog) notFound();

  const { data, error } = await supabase.rpc("open_material", {
    p_material_id: id,
  });

  if (error || typeof data !== "string" || !data) {
    return (
      <StudentPage width="narrow">
        <PageHeader
          title={catalog.title}
          description={catalog.description || undefined}
        />
        <ResourceLockNotice />
      </StudentPage>
    );
  }

  const embed = youtubeEmbedSrc(data);
  if (!embed) {
    redirect(data);
  }

  return (
    <StudentPage width="article">
      <PageHeader
        title={catalog.title}
        description={catalog.description || undefined}
      />
      <div className="overflow-hidden rounded-xl border bg-black">
        <iframe
          title={catalog.title}
          src={embed}
          className="aspect-video w-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
      <Button asChild variant="outline" size="sm" className="w-fit">
        <a href={data} target="_blank" rel="noreferrer">
          Open on YouTube
        </a>
      </Button>
    </StudentPage>
  );
}
