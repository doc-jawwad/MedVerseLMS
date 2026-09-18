import Link from "next/link";
import { requireStudent } from "@/lib/auth/require-user";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChangePasswordForm } from "./change-password-form";
import {
  YearChangePanel,
  type YearChangeRequestView,
  type YearOption,
} from "./year-change-panel";

export const metadata = { title: "My Account — MedVerse LMS" };

export default async function ProfilePage() {
  const { supabase, profile, enrollment, userId } = await requireStudent();

  const [
    { data: grants },
    { data: live },
    { data: yearRows },
    { data: ycRows },
  ] = await Promise.all([
    supabase
      .from("access_grants")
      .select("grant_type, subjects(name), material_folders(name)")
      .eq("student_id", userId)
      .eq("grant_type", "practice_subject")
      .is("revoked_at", null),
    supabase.rpc("has_live_subscription"),
    supabase.rpc("list_years"),
    supabase
      .from("year_change_requests")
      .select(
        "id, status, reason, review_note, created_at, reviewed_at, from_year_id, to_year_id"
      )
      .eq("student_id", userId)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const years = (yearRows ?? []) as YearOption[];
  const yearName = (id: string) =>
    years.find((y) => y.id === id)?.name ?? null;

  const mapped: YearChangeRequestView[] = (ycRows ?? []).map((r) => ({
    id: r.id,
    status: r.status,
    reason: r.reason,
    review_note: r.review_note,
    created_at: r.created_at,
    reviewed_at: r.reviewed_at,
    from_year_id: r.from_year_id,
    to_year_id: r.to_year_id,
    from_name: yearName(r.from_year_id),
    to_name: yearName(r.to_year_id),
  }));

  const pending = mapped.find((r) => r.status === "pending") ?? null;
  const latestRejected =
    mapped.find((r) => r.status === "rejected") ?? null;

  return (
    <div className="grid max-w-2xl gap-6">
      <h1 className="text-2xl font-semibold">My Account</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Account</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          <Row label="Name">{profile.full_name}</Row>
          <Row label="Email">{profile.email}</Row>
          <Row label="Year">{enrollment.year_name}</Row>
          <Row label="Enrollment status">
            <Badge variant={enrollment.status === "active" ? "default" : "outline"}>
              {enrollment.status}
            </Badge>
          </Row>
          <Row label="Subscription">
            <Badge variant={live.data ? "default" : "outline"}>
              {live.data ? "active" : "no active plan"}
            </Badge>
          </Row>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Academic year</CardTitle>
          <CardDescription>
            Your class year is fixed until an admin approves a change request.
            Account status and subscription stay separate.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <YearChangePanel
            currentYearId={enrollment.year_id}
            currentYearName={enrollment.year_name}
            years={years}
            pending={pending}
            latestRejected={pending ? null : latestRejected}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Subscription</CardTitle>
          <CardDescription>
            View status, payment instructions, and submit or update an
            application.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/subscription">
              {live.data ? "My Subscription" : "Get Subscription"}
            </Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Practice access</CardTitle>
          <CardDescription>
            Subjects your admin has granted you for practice MCQs.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-1 text-sm">
          {(grants ?? []).length === 0 && (
            <p className="text-muted-foreground">
              No practice subjects granted yet — ask your admin.
            </p>
          )}
          {(grants ?? []).map((g, i) => {
            const s = g.subjects as unknown as { name: string } | null;
            return <div key={i}>{s?.name}</div>;
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Change password</CardTitle>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span>{children}</span>
    </div>
  );
}
