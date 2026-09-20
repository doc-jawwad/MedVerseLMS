import { Suspense } from "react";
import { requireStudent } from "@/lib/auth/require-user";
import { PracticeMcqSession } from "@/components/practice/practice-mcq-session";
import type { PracticeScopeType } from "@/lib/practice/types";

export const metadata = { title: "Practice session — MedVerse LMS" };

export default async function PracticeSessionPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; id?: string; name?: string }>;
}) {
  const { userId } = await requireStudent();
  const { scope, id, name } = await searchParams;

  if (!scope || !id || !["subject", "book", "chapter", "topic"].includes(scope)) {
    return <p className="text-muted-foreground">Invalid practice scope.</p>;
  }

  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
      <PracticeMcqSession
        studentId={userId}
        scope={{
          type: scope as PracticeScopeType,
          id,
          title: name ?? "Practice",
        }}
      />
    </Suspense>
  );
}
