import { requireStudent } from "@/lib/auth/require-user";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChangePasswordForm } from "./change-password-form";

export const metadata = { title: "My Account — MedVerse LMS" };

export default async function ProfilePage() {
  const { supabase, profile, enrollment, userId } = await requireStudent();

  const { data: grants } = await supabase
    .from("access_grants")
    .select("grant_type, subjects(name), material_folders(name)")
    .eq("student_id", userId)
    .eq("grant_type", "practice_subject")
    .is("revoked_at", null);

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
