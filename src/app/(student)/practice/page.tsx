import Link from "next/link";
import { requireStudent } from "@/lib/auth/require-user";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const metadata = { title: "Practice MCQs — MedVerse LMS" };

type PracticeSubject = {
  subject_id: string;
  subject_name: string;
  approved_questions: number;
  granted: boolean;
  answered: number;
  correct: number;
};

export default async function PracticePage() {
  const { supabase } = await requireStudent();
  const { data } = await supabase.rpc("practice_subjects");
  const subjects = (data ?? []) as PracticeSubject[];

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Practice MCQs</h1>
        <p className="text-muted-foreground">
          Learn with instant feedback — answers and explanations after every
          question.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {subjects.map((s) => {
          const acc =
            s.answered > 0 ? Math.round((100 * s.correct) / s.answered) : null;
          const card = (
            <Card
              className={
                s.granted
                  ? "h-full transition-colors hover:bg-accent/40"
                  : "h-full opacity-60"
              }
            >
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-lg">
                  {s.subject_name}
                  {!s.granted && <Badge variant="outline">locked</Badge>}
                </CardTitle>
                <CardDescription>
                  {s.approved_questions} questions available
                </CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {s.granted
                  ? s.answered > 0
                    ? `${s.answered} answered · ${acc}% correct`
                    : "Not started yet"
                  : "Ask your admin for access"}
              </CardContent>
            </Card>
          );
          return s.granted ? (
            <Link key={s.subject_id} href={`/practice/${s.subject_id}`}>
              {card}
            </Link>
          ) : (
            <div key={s.subject_id}>{card}</div>
          );
        })}
        {subjects.length === 0 && (
          <p className="text-muted-foreground">
            No subjects found for your year yet.
          </p>
        )}
      </div>
    </div>
  );
}
