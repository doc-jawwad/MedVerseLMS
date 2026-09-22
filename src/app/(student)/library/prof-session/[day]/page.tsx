import { redirect } from "next/navigation";
import { ACADEMIC_BASE_PATH, PROF_SESSION_SLUG } from "@/lib/academic-tree";

/** Legacy flat day URL → Prof. Session home (subject-scoped IA). */
type Props = { params: Promise<{ day: string }> };

export default async function LibraryProfDayRedirect({ params }: Props) {
  void (await params);
  redirect(`${ACADEMIC_BASE_PATH}/${PROF_SESSION_SLUG}`);
}
