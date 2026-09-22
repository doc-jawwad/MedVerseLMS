import { Suspense } from "react";
import { requireStudent } from "@/lib/auth/require-user";
import { PracticeMcqSession } from "@/components/practice/practice-mcq-session";
import { parsePracticeScopeParam } from "@/lib/practice/scope";

export const metadata = { title: "Practice session — MedVerse LMS" };

export default async function PracticeSessionPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; id?: string; name?: string }>;
}) {
  const { userId } = await requireStudent();
  const { scope, id, name } = await searchParams;
  const scopeType = parsePracticeScopeParam(scope);

  if (!scopeType || !id) {
    return <p className="text-muted-foreground">Invalid practice scope.</p>;
  }

  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
      <PracticeMcqSession
        studentId={userId}
        scope={{
          type: scopeType,
          id,
          title: name ?? "Practice",
        }}
      />
    </Suspense>
  );
}
