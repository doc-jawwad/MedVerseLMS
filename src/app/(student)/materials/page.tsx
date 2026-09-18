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

export const metadata = { title: "Study Materials — MedVerse LMS" };

export default async function MaterialsPage() {
  const { supabase } = await requireStudent();

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
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Study Materials</h1>
        <p className="text-muted-foreground">
          Links open in Google Drive — download from there.
        </p>
      </div>

      {(folders ?? []).map((f) => {
        const items = (materials ?? []).filter((m) => m.folder_id === f.id);
        const locked = !entitled.has(f.id);
        return (
          <Card key={f.id} className={locked ? "opacity-95" : undefined}>
            <CardHeader>
              <CardTitle className="text-base">
                📁 {f.name}{" "}
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
                    className={`flex items-center justify-between rounded-md border p-3 text-sm ${
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
        <p className="text-muted-foreground">
          No study materials for your year yet.
        </p>
      )}
    </div>
  );
}
