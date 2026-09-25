import Link from "next/link";
import { requireAdmin } from "@/lib/auth/require-user";
import { requireAdminClass } from "@/lib/admin/require-admin-class";
import { requireAdminAnyPermission } from "@/lib/admin/require-admin-permission";
import { yearDisplayName } from "@/lib/library/types";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata = { title: "MCQ Bank folders — MedVerse Admin" };

export default async function AdminMcqBankPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const gate = await requireAdminAnyPermission(
    ["edit_questions"],
    "MCQ Bank folders"
  );
  if (gate.denied) return gate.denied;
  const { supabase } = await requireAdmin();
  const params = await searchParams;

  return requireAdminClass({
    searchYear: params.year,
    next: "/admin/mcq-bank",
    children: async (year) => {
      const { data: subjectRows } = await supabase
        .from("subjects")
        .select("id, name, product_key, sort_order")
        .eq("year_id", year.id)
        .not("product_key", "is", null)
        .order("sort_order")
        .order("name");

      const subjects = (subjectRows ?? []).filter(
        (s) => typeof s.product_key === "string" && s.product_key
      );

      return (
        <div className="grid gap-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold tracking-[0.16em] text-primary uppercase">
                Content
              </p>
              <h1 className="font-heading text-2xl font-semibold text-[var(--student-ink)]">
                MCQ Bank folders
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Academic folders under product Blocks for{" "}
                {yearDisplayName(year)}. Question Bank taxonomy stays separate.
              </p>
            </div>
            <Button asChild size="sm" variant="outline" className="w-fit shrink-0">
              <Link href={`/admin/mcq-bank/classify?year=${year.id}`}>
                Classify unassigned
              </Link>
            </Button>
          </div>

          {subjects.length === 0 ? (
            <p className="rounded-xl border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
              No product subjects for this class. Create Blocks / Final Year
              subjects with a product key first.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {subjects.map((s) => (
                <Card key={s.id} className="shadow-none">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">{s.name}</CardTitle>
                    <CardDescription className="break-all font-mono text-xs">
                      {s.product_key}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button asChild size="sm" className="w-full sm:w-auto">
                      <Link href={`/admin/mcq-bank/${s.product_key}?year=${year.id}`}>
                        Manage folders
                      </Link>
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      );
    },
  });
}
