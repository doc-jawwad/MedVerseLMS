import { redirect } from "next/navigation";
import { ACADEMIC_BASE_PATH, PROF_SESSION_SLUG } from "@/lib/academic-tree";

type Props = { params: Promise<{ block: string }> };

export default async function ResourcesBlockRedirect({ params }: Props) {
  const { block } = await params;
  if (block === PROF_SESSION_SLUG) {
    redirect(`${ACADEMIC_BASE_PATH}/${PROF_SESSION_SLUG}`);
  }
  redirect(`${ACADEMIC_BASE_PATH}/${encodeURIComponent(block)}`);
}
