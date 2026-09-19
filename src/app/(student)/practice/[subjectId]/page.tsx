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
import { PageHeader } from "@/components/student/page-header";
import { StudentPage } from "@/components/student/student-page";
import { EmptyState } from "@/components/student/empty-state";
import { SectionLock } from "@/components/subscription/section-lock";
import { getStudentHasLiveSubscription } from "@/lib/subscriptions/student-live-access";
import { studentHasPaidLmsSections } from "@/lib/subscriptions/student-section-access";

export const metadata = { title: "Practice — MedVerse LMS" };

type OverviewRow = {
  book_id: string;
  book_name: string;
  chapter_id: string;
  chapter_name: string;
  approved_questions: number;
};

type PracticeSubject = {
  subject_id: string;
  granted: boolean;
};

export default async function PracticeSubjectPage({
  params,
}: {
  params: Promise<{ subjectId: string }>;
}) {
  const { supabase } = await requireStudent();
  const { subjectId } = await params;
  const hasLiveAccess = await getStudentHasLiveSubscription();

  if (!studentHasPaidLmsSections(hasLiveAccess)) {
    const { data: subjects } = await supabase.rpc("practice_subjects");
    const allowed = ((subjects ?? []) as PracticeSubject[]).some(
      (s) => s.subject_id === subjectId && s.granted
    );
    if (!allowed) {
      return (
        <SectionLock
        title="MCQ Bank"
        description="This subject requires a live subscription. Free practice stays under Free Resources."
        />
      );
    }
  }

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
    <StudentPage>
      <PageHeader
        title={subject.name}
        description={`${total} questions available`}
        actions={
          total > 0 ? (
            <Button asChild>
              <Link
                href={`/practice/session?scope=subject&id=${subject.id}&name=${encodeURIComponent(subject.name)}`}
              >
                Practice whole subject
              </Link>
            </Button>
          ) : undefined
        }
      />

      {[...books.entries()].map(([bookId, book]) => (
        <div key={bookId} className="grid gap-3">
          <h2 className="font-heading text-[13px] font-semibold tracking-[0.12em] text-[#072855]/65 uppercase">
            {book.name}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {book.chapters.map((c) => (
              <Card key={c.chapter_id} className="flex flex-col shadow-none">
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
        <EmptyState title="No chapters with questions yet." />
      )}
    </StudentPage>
  );
}
