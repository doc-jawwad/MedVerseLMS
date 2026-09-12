import { requireStudent } from "@/lib/auth/require-user";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata = { title: "Dashboard — MedVerse LMS" };

export default async function DashboardPage() {
  const { profile, enrollment } = await requireStudent();

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">
          Welcome, {profile.full_name || "Student"}
        </h1>
        <p className="text-muted-foreground">{enrollment.year_name}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Upcoming tests</CardTitle>
          <CardDescription>
            Scheduled tests will appear here once the exam module is live.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Nothing scheduled yet.
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Performance</CardTitle>
          <CardDescription>
            Your test statistics will appear here after your first test.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          No tests taken yet.
        </CardContent>
      </Card>
    </div>
  );
}
