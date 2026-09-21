import { redirect } from "next/navigation";
import { ACADEMIC_BASE_PATH } from "@/lib/academic-tree";

/** Legacy Resources surface → unified Academic tree. */
export default function ResourcesRedirectPage() {
  redirect(ACADEMIC_BASE_PATH);
}
