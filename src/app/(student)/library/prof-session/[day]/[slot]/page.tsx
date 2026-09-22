import { redirect } from "next/navigation";
import { ACADEMIC_BASE_PATH, PROF_SESSION_SLUG } from "@/lib/academic-tree";

type Props = { params: Promise<{ day: string; slot: string }> };

export default async function LibraryProfSlotRedirect({ params }: Props) {
  void (await params);
  redirect(`${ACADEMIC_BASE_PATH}/${PROF_SESSION_SLUG}`);
}
