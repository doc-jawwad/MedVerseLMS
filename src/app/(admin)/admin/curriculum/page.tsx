import Link from "next/link";
import { requireAdmin } from "@/lib/auth/require-user";
import { CurriculumTree, type SubjectNode } from "./curriculum-tree";

export const metadata = { title: "Curriculum — MedVerse Admin" };

export default async function CurriculumPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const { supabase } = await requireAdmin();
  const { year } = await searchParams;

  const { data: years } = await supabase
    .from("years")
    .select("id, year_number, name")
    .order("year_number");

  const activeYear =
    (years ?? []).find((y) => String(y.year_number) === year) ?? years?.[0];

  let tree: SubjectNode[] = [];
  if (activeYear) {
    const [{ data: subjects }, { data: books }, { data: chapters }, { data: topics }] =
      await Promise.all([
        supabase
          .from("subjects")
          .select("id, name, sort_order")
          .eq("year_id", activeYear.id)
          .order("sort_order")
          .order("name"),
        supabase
          .from("books")
          .select("id, name, subject_id")
          .eq("year_id", activeYear.id)
          .order("sort_order")
          .order("name"),
        supabase
          .from("chapters")
          .select("id, name, book_id")
          .eq("year_id", activeYear.id)
          .order("sort_order")
          .order("name"),
        supabase
          .from("topics")
          .select("id, name, chapter_id")
          .eq("year_id", activeYear.id)
          .order("sort_order")
          .order("name"),
      ]);

    tree = (subjects ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      books: (books ?? [])
        .filter((b) => b.subject_id === s.id)
        .map((b) => ({
          id: b.id,
          name: b.name,
          chapters: (chapters ?? [])
            .filter((c) => c.book_id === b.id)
            .map((c) => ({
              id: c.id,
              name: c.name,
              topics: (topics ?? [])
                .filter((t) => t.chapter_id === c.id)
                .map((t) => ({ id: t.id, name: t.name })),
            })),
        })),
    }));
  }

  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold">Curriculum</h1>

      <div className="flex gap-2">
        {(years ?? []).map((y) => (
          <Link
            key={y.id}
            href={`/admin/curriculum?year=${y.year_number}`}
            className={`rounded-md border px-3 py-1.5 text-sm ${
              activeYear?.id === y.id ? "bg-accent font-medium" : "hover:bg-accent/50"
            }`}
          >
            Year {y.year_number}
          </Link>
        ))}
      </div>

      {activeYear && <CurriculumTree yearId={activeYear.id} subjects={tree} />}
    </div>
  );
}
