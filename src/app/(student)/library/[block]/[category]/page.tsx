import { redirect } from "next/navigation";
import { ACADEMIC_BASE_PATH } from "@/lib/academic-tree";

type Props = { params: Promise<{ block: string; category: string }> };

export default async function LibraryCategoryRedirect({ params }: Props) {
  const { block, category } = await params;
  redirect(
    `${ACADEMIC_BASE_PATH}/${encodeURIComponent(block)}/${encodeURIComponent(category)}`
  );
}
