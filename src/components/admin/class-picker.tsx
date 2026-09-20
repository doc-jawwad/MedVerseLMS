import Link from "next/link";
import { yearDisplayName } from "@/lib/library/types";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { setAdminClassAction } from "@/lib/actions/admin-class";
import type { AdminYearOption } from "@/components/admin/class-selector";

export function AdminClassPicker({
  years,
  next,
}: {
  years: AdminYearOption[];
  next: string;
}) {
  return (
    <div className="grid gap-6">
      <div>
        <p className="text-[11px] font-semibold tracking-[0.16em] text-primary uppercase">
          Class first
        </p>
        <h1 className="font-heading text-2xl font-semibold text-[var(--student-ink)]">
          Select a class
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Manage Free Resources, the full library, question bank, and tests for one
          MBBS year at a time.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {years.map((y) => (
          <form key={y.id} action={setAdminClassAction}>
            <input type="hidden" name="yearId" value={y.id} />
            <input type="hidden" name="next" value={next} />
            <button type="submit" className="w-full text-left">
              <Card className="h-full shadow-none transition-colors hover:bg-accent/40">
                <CardHeader>
                  <CardTitle className="text-lg text-[var(--student-ink)]">
                    {yearDisplayName(y)}
                  </CardTitle>
                  <CardDescription>Year {y.year_number}</CardDescription>
                </CardHeader>
              </Card>
            </button>
          </form>
        ))}
      </div>
      <Button asChild variant="outline" className="w-fit">
        <Link href="/admin">Back to overview</Link>
      </Button>
    </div>
  );
}
