import { redirect } from "next/navigation";
import { ACADEMIC_BASE_PATH } from "@/lib/academic-tree";

/** Legacy Library surface → unified Academic tree. */
export default function LibraryRedirectPage() {
  redirect(ACADEMIC_BASE_PATH);
}
