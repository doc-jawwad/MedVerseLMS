import { requireAdmin } from "@/lib/auth/require-user";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import Link from "next/link";

export const metadata = { title: "Admin — MedVerse LMS" };

export default async function AdminOverviewPage() {
  const { supabase } = await requireAdmin();

  const [{ count: pendingCount }, { count: activeCount }] = await Promise.all([
    supabase
      .from("enrollments")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    supabase
      .from("enrollments")
      .select("id", { count: "exact", head: true })
      .eq("status", "active"),
  ]);

  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold">Overview</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Link href="/admin/students?status=pending">
          <Card className="transition-colors hover:bg-accent/40">
            <CardHeader>
              <CardTitle className="text-3xl">{pendingCount ?? 0}</CardTitle>
              <CardDescription>Pending approvals</CardDescription>
            </CardHeader>
          </Card>
        </Link>
        <Link href="/admin/students">
          <Card className="transition-colors hover:bg-accent/40">
            <CardHeader>
              <CardTitle className="text-3xl">{activeCount ?? 0}</CardTitle>
              <CardDescription>Active students</CardDescription>
            </CardHeader>
          </Card>
        </Link>
      </div>
    </div>
  );
}
