import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStudent } from "@/lib/auth/require-user";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata = { title: "Practice — MedVerse LMS" };

type OverviewRow = {
  book_id: string;
  book_name: string;
  chapter_id: string;
  chapter_name: string;
  approved_questions: number;
};

export default async function PracticeSubjectPage({
  params,
}: {
  params: Promise<{ subjectId: string }>;
}) {
  const { supabase } = await requireStudent();
  const { subjectId } = await params;

  const [{ data: subject }, { data: overview, error }] = await Promise.all([
    supabase.from("subjects").select("id, name").eq("id", subjectId).maybeSingle(),
    supabase.rpc("practice_subject_overview", { p_subject_id: subjectId }),
  ]);
  if (!subject || error) notFound();

  const rows = (overview ?? []) as OverviewRow[];
  const books = new Map<string, { name: string; chapters: OverviewRow[] }>();
  for (const r of rows) {
    if (!books.has(r.book_id)) books.set(r.book_id, { name: r.book_name, chapters: [] });
    books.get(r.book_id)!.chapters.push(r);
  }
  const total = rows.reduce((a, r) => a + Number(r.approved_questions), 0);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">{subject.name}</h1>
          <p className="text-muted-foreground">{total} questions available</p>
        </div>
        {total > 0 && (
          <Button asChild>
            <Link
              href={`/practice/session?scope=subject&id=${subject.id}&name=${encodeURIComponent(subject.name)}`}
            >
              Practice whole subject
            </Link>
          </Button>
        )}
      </div>

      {[...books.entries()].map(([bookId, book]) => (
        <div key={bookId} className="grid gap-3">
          <h2 className="font-medium text-muted-foreground">{book.name}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {book.chapters.map((c) => (
              <Card key={c.chapter_id} className="flex flex-col">
                <CardHeader className="flex-1">
                  <CardTitle className="text-base">{c.chapter_name}</CardTitle>
                  <CardDescription>
                    {c.approved_questions} question
                    {Number(c.approved_questions) === 1 ? "" : "s"}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button
                    asChild
                    variant="secondary"
                    size="sm"
                    disabled={Number(c.approved_questions) === 0}
                  >
                    <Link
                      href={`/practice/session?scope=chapter&id=${c.chapter_id}&name=${encodeURIComponent(c.chapter_name)}`}
                    >
                      Start practice
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ))}

      {rows.length === 0 && (
        <p className="text-muted-foreground">No chapters with questions yet.</p>
      )}
    </div>
  );
}
