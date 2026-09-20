import Link from "next/link";
import { requireStudent } from "@/lib/auth/require-user";
import {
  createStudentProfileAdapter,
  createSubscriptionClassAdapter,
} from "@/lib/profile/adapter";
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
import { ProfileEditForm } from "./profile-edit-form";
import { ClassPanel } from "./class-panel";
import type { YearChangeRequestView } from "./year-change-panel";
import { PageHeader } from "@/components/student/page-header";
import { StudentPage } from "@/components/student/student-page";
import { FieldRow } from "@/components/student/field-row";
import { InstallMedverseApp } from "@/components/pwa/install-medverse-app";

export const metadata = { title: "My Account — MedVerse LMS" };

export default async function ProfilePage() {
  const { supabase, userId } = await requireStudent();
  const profileAdapter = createStudentProfileAdapter(supabase);
  const classAdapter = createSubscriptionClassAdapter(supabase);

  const [profileRes, lockRes, yearsRes, ycRes, liveRes, grantsRes] =
    await Promise.all([
      profileAdapter.getOwnProfile(),
      classAdapter.getClassLockState(),
      classAdapter.listYears(),
      classAdapter.listOwnYearChangeRequests(),
      supabase.rpc("has_live_subscription"),
      supabase
        .from("access_grants")
        .select("grant_type, subjects(name), material_folders(name)")
        .eq("student_id", userId)
        .eq("grant_type", "practice_subject")
        .is("revoked_at", null),
    ]);

  if (!profileRes.ok || !lockRes.ok) {
    return (
      <StudentPage width="narrow">
        <PageHeader title="My Account" />
        <p className="text-sm text-muted-foreground">
          Could not load your profile. Please refresh and try again.
        </p>
      </StudentPage>
    );
  }

  const profile = profileRes.data;
  const lock = lockRes.data;
  const years = yearsRes.ok ? yearsRes.data : [];
  const mapped: YearChangeRequestView[] = ycRes.ok ? ycRes.data : [];
  const pending = mapped.find((r) => r.status === "pending") ?? null;
  const latestRejected =
    mapped.find((r) => r.status === "rejected") ?? null;

  return (
    <StudentPage width="narrow">
      <PageHeader title="My Account" />

      <InstallMedverseApp variant="card" />

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-base text-[var(--student-ink)]">Profile</CardTitle>
          <CardDescription>
            Biodata, contact, college, and photo. Contact details stay private —
            leaderboards only show name, college, and photo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProfileEditForm
            fullName={profile.full_name}
            email={profile.email}
            contactNumber={profile.contact_number}
            collegeName={profile.college_name}
            avatarUrl={profile.avatar_url}
          />
        </CardContent>
      </Card>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-base text-[var(--student-ink)]">Class</CardTitle>
          <CardDescription>
            Free students can change class freely. Pending or active
            subscriptions lock class to the purchased year.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ClassPanel
            lock={lock}
            years={years}
            pending={pending}
            latestRejected={pending ? null : latestRejected}
          />
        </CardContent>
      </Card>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-base text-[var(--student-ink)]">Subscription</CardTitle>
          <CardDescription>
            View status, payment instructions, and submit or update an
            application. Confirm your purchase class before paying.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <FieldRow label="Status">
            <Badge variant={liveRes.data ? "default" : "outline"}>
              {liveRes.data ? "active" : "no active plan"}
            </Badge>
          </FieldRow>
          <Button asChild className="w-fit">
            <Link href="/subscription">
              {liveRes.data ? "My Subscription" : "Get Subscription"}
            </Link>
          </Button>
        </CardContent>
      </Card>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-base text-[var(--student-ink)]">Practice access</CardTitle>
          <CardDescription>
            Subjects your admin has granted you for practice MCQs.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-1 text-sm">
          {(grantsRes.data ?? []).length === 0 && (
            <p className="text-muted-foreground">
              No practice subjects granted yet — ask your admin.
            </p>
          )}
          {(grantsRes.data ?? []).map((g, i) => {
            const s = g.subjects as unknown as { name: string } | null;
            return <div key={i}>{s?.name}</div>;
          })}
        </CardContent>
      </Card>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-base text-[var(--student-ink)]">Change password</CardTitle>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>
    </StudentPage>
  );
}
