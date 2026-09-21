import { redirect } from "next/navigation";
import { ACADEMIC_BASE_PATH, PROF_SESSION_SLUG } from "@/lib/academic-tree";

export default function LibraryProfSessionRedirect() {
  redirect(`${ACADEMIC_BASE_PATH}/${PROF_SESSION_SLUG}`);
}
