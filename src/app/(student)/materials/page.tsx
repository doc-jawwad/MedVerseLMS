import { requireStudent } from "@/lib/auth/require-user";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const metadata = { title: "Study Materials — MedVerse LMS" };

export default async function MaterialsPage() {
  const { supabase } = await requireStudent();

  const [{ data: folders }, { data: materials }, { data: subjects }] =
    await Promise.all([
      supabase
        .from("material_folders")
        .select("id, name, subject_id")
        .order("sort_order")
        .order("name"),
      supabase
        .from("materials")
        .select("id, folder_id, title, description, file_type, drive_url")
        .order("sort_order")
        .order("title"),
      supabase.from("subjects").select("id, name"),
    ]);

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
        return (
          <Card key={f.id}>
            <CardHeader>
              <CardTitle className="text-base">
                📁 {f.name}{" "}
                {f.subject_id && (
                  <Badge variant="outline">{subjectName(f.subject_id)}</Badge>
                )}
              </CardTitle>
              {items.length === 0 && (
                <CardDescription>Nothing here yet.</CardDescription>
              )}
            </CardHeader>
            {items.length > 0 && (
              <CardContent className="grid gap-2">
                {items.map((m) => (
                  <a
                    key={m.id}
                    href={m.drive_url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between rounded-md border p-3 text-sm transition-colors hover:bg-accent/50"
                  >
                    <div>
                      <span className="font-medium">{m.title}</span>
                      {m.description && (
                        <p className="text-xs text-muted-foreground">
                          {m.description}
                        </p>
                      )}
                    </div>
                    <Badge variant="secondary" className="uppercase">
                      {m.file_type}
                    </Badge>
                  </a>
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
