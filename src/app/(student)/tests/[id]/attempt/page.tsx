import { requireStudent } from "@/lib/auth/require-user";
import { AttemptClient } from "./attempt-client";

export const metadata = { title: "Exam — MedVerse LMS" };

export default async function AttemptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireStudent(); // gate + session policy; the RPC re-checks everything
  const { id } = await params;
  return <AttemptClient testId={id} />;
}
