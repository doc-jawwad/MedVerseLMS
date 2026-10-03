import { requireStudent } from "@/lib/auth/require-user";
import { formatDateTime } from "@/lib/utils";
import { EmptyState } from "@/components/student/empty-state";
import { ActivityItem } from "@/components/student/activity-item";
import { StatusBadge } from "@/components/student/status-badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type RecentTest = {
  test_id: string;
  title: string;
  score: number;
  max_score: number;
  percentage: number;
  rank: number | null;
  submitted_at: string;
};

/** Deferred recent-tests history card. */
export async function DashboardRecentSection() {
  let failed = false;
  let recentRows: RecentTest[] = [];

  try {
    const { supabase } = await requireStudent();
    const { data: recent } = await supabase.rpc("student_recent_tests", {
      p_limit: 5,
    });
    recentRows = (recent ?? []) as RecentTest[];
  } catch (err) {
    console.error("dashboard recent section failed", err);
    failed = true;
  }

  if (failed) {
    return (
      <Card className="surface-card border-border/80 shadow-none">
        <CardHeader>
          <CardTitle className="font-heading text-base text-ink">
            Recent tests
          </CardTitle>
          <CardDescription>
            Submitted history — kept after subscription expiry.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EmptyState
            title="History unavailable"
            description="Could not load recent tests. Refresh to try again."
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      className="surface-card border-border/80 shadow-none"
      data-testid="dashboard-recent"
    >
      <CardHeader>
        <CardTitle className="font-heading text-base text-ink">
          Recent tests
        </CardTitle>
        <CardDescription>
          Submitted history — kept after subscription expiry.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {recentRows.length === 0 ? (
          <EmptyState
            title="No history yet"
            description="Submitted tests will list here with your score and rank."
          />
        ) : (
          <div className="grid gap-2">
            {recentRows.map((r) => (
              <ActivityItem
                key={r.test_id}
                href={`/tests/${r.test_id}/result`}
                title={r.title}
                meta={
                  r.rank != null
                    ? `${formatDateTime(r.submitted_at)} · Rank #${r.rank}`
                    : formatDateTime(r.submitted_at)
                }
                trailing={
                  <StatusBadge tone="info">{r.percentage}%</StatusBadge>
                }
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
