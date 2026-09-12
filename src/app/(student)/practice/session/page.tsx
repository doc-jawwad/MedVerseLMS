import { Suspense } from "react";
import { PracticeSession } from "./practice-session";

export const metadata = { title: "Practice session — MedVerse LMS" };

export default async function PracticeSessionPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; id?: string; name?: string }>;
}) {
  const { scope, id, name } = await searchParams;

  if (!scope || !id || !["subject", "book", "chapter", "topic"].includes(scope)) {
    return <p className="text-muted-foreground">Invalid practice scope.</p>;
  }

  return (
    <Suspense>
      <PracticeSession scopeType={scope} scopeId={id} title={name ?? "Practice"} />
    </Suspense>
  );
}
