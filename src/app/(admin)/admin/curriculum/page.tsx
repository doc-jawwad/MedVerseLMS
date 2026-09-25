import { requireAdmin } from "@/lib/auth/require-user";
import { requireAdminAnyPermission } from "@/lib/admin/require-admin-permission";
import { requireAdminClass } from "@/lib/admin/require-admin-class";
import { setAdminClassAction } from "@/lib/actions/admin-class";
import { CurriculumTree, type SubjectNode } from "./curriculum-tree";

export const metadata = { title: "Curriculum — MedVerse Admin" };

export default async function CurriculumPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const { supabase } = await requireAdmin();
  const gate = await requireAdminAnyPermission(
    ["manage_curriculum"],
    "Curriculum"
  );
  if (gate.denied) return gate.denied;

  const params = await searchParams;

  return requireAdminClass({
    searchYear: params.year,
    next: "/admin/curriculum",
    children: async (activeYear) => {
      const { data: years } = await supabase
        .from("years")
        .select("id, year_number, name")
        .order("year_number");

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

      const tree: SubjectNode[] = (subjects ?? []).map((s) => ({
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

      return (
        <div className="grid gap-6">
          <h1 className="text-2xl font-semibold">Curriculum</h1>

          <div className="flex flex-wrap gap-2">
            {(years ?? []).map((y) => (
              <form key={y.id} action={setAdminClassAction}>
                <input type="hidden" name="yearId" value={y.id} />
                <input type="hidden" name="next" value="/admin/curriculum" />
                <button
                  type="submit"
                  className={`rounded-md border px-3 py-1.5 text-sm ${
                    activeYear.id === y.id
                      ? "bg-accent font-medium"
                      : "hover:bg-accent/50"
                  }`}
                >
                  Year {y.year_number}
                </button>
              </form>
            ))}
          </div>

          <CurriculumTree yearId={activeYear.id} subjects={tree} />
        </div>
      );
    },
  });
}
