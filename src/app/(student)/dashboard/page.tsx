import Link from "next/link";
import { requireStudent } from "@/lib/auth/require-user";
import { formatDateTime } from "@/lib/utils";
import { buildStudentDashboardPresentation } from "@/lib/tests/student-dashboard-presentation";
import { classifyCatalogTestStates } from "@/lib/tests/student-test-state";
import { buildStudentSubscriptionView } from "@/lib/subscriptions/student-status";
import { ResourceLockNotice } from "@/components/subscription/resource-lock-notice";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Dashboard — MedVerse LMS" };

type RecentTest = {
  test_id: string;
  title: string;
  score: number;
  max_score: number;
  percentage: number;
  rank: number | null;
  submitted_at: string;
};

export default async function DashboardPage() {
  const { supabase, profile, enrollment, userId } = await requireStudent();

  const now = new Date();
  const nowIso = now.toISOString();

  const [
    { data: summary },
    { data: recent },
    { data: upcoming },
    { data: catalogTests },
    { data: myAttempts },
    { data: accessible },
    { data: liveSub },
    { data: subscriptions },
    { data: applications },
    { data: grants },
  ] = await Promise.all([
    supabase.rpc("student_test_summary"),
    supabase.rpc("student_recent_tests", { p_limit: 5 }),
    supabase
      .from("tests")
      .select(
        "id, title, subjects(name), duration_minutes, opens_at, closes_at, question_count, entitlement"
      )
      .eq("status", "published")
      .lte("opens_at", nowIso)
      .gt("closes_at", nowIso)
      .order("closes_at", { ascending: true })
      .limit(10),
    supabase
      .from("tests")
      .select("id, status, opens_at, closes_at, entitlement"),
    supabase
      .from("test_attempts")
      .select("test_id, state")
      .eq("student_id", userId)
      .neq("state", "invalidated"),
    supabase.rpc("accessible_test_ids"),
    supabase.rpc("has_live_subscription"),
    supabase
      .from("subscriptions")
      .select(
        "id, status, starts_at, ends_at, grace_days, paid_access_mode, subscription_plans(name)"
      )
      .eq("student_id", userId)
      .order("ends_at", { ascending: false }),
    supabase
      .from("subscription_applications")
      .select(
        "id, status, amount, currency, created_at, review_note, reviewed_at"
      )
      .eq("student_id", userId)
      .order("created_at", { ascending: false }),
    supabase
      .from("access_grants")
      .select("test_id, created_at, revoked_at")
      .eq("student_id", userId)
      .eq("grant_type", "test"),
  ]);

  const entitled = new Set(
    (accessible ?? []).map((row: { id: string }) => row.id)
  );
  const attemptedIds = new Set(
    (myAttempts ?? [])
      .filter((a) => a.state === "submitted" || a.state === "in_progress")
      .map((a) => a.test_id)
  );
  const nextTest = (upcoming ?? []).find((t) => !attemptedIds.has(t.id));

  const subRows = (subscriptions ?? []).map((s) => {
    const plan = s.subscription_plans as unknown as { name: string } | null;
    return {
      id: s.id as string,
      status: s.status as "active" | "expired" | "deactivated",
      starts_at: s.starts_at as string,
      ends_at: s.ends_at as string,
      plan_name: plan?.name ?? null,
      grace_days: (s.grace_days as number | null) ?? 0,
      paid_access_mode: s.paid_access_mode as string | null,
    };
  });

  const subView = buildStudentSubscriptionView({
    hasLiveAccess: Boolean(liveSub),
    subscriptions: subRows,
    applications: (applications ?? []).map((a) => ({
      id: a.id as string,
      status: a.status as string,
      amount: Number(a.amount),
      currency: a.currency as string,
      created_at: a.created_at as string,
      review_note: (a.review_note as string | null) ?? null,
      reviewed_at: (a.reviewed_at as string | null) ?? null,
    })),
    now,
  });

  const catalogStates = classifyCatalogTestStates({
    nowMs: now.getTime(),
    tests: catalogTests ?? [],
    attempts: myAttempts ?? [],
    accessibleIds: (accessible ?? []).map((row: { id: string }) => row.id),
    subscriptions: subRows.map((s) => ({
      starts_at: s.starts_at,
      ends_at: s.ends_at,
    })),
    grants: grants ?? [],
  });

  const s = summary as {
    tests_taken: number;
    average_percentage: number;
    best_percentage: number;
    average_rank: number;
  } | null;

  const presentation = buildStudentDashboardPresentation({
    subscriptionKind: subView.kind,
    lifetime: s,
    catalogStates,
  });

  const subj = nextTest?.subjects as unknown as { name: string } | null;
  const nextEntitled = nextTest ? entitled.has(nextTest.id) : false;

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">
          Welcome, {profile.full_name || "Student"}
        </h1>
        <p className="text-muted-foreground">{enrollment.year_name}</p>
      </div>

      {presentation.accessBanner && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              {presentation.accessBanner.title}
            </CardTitle>
            <CardDescription>
              {presentation.accessBanner.description}
            </CardDescription>
          </CardHeader>
          {presentation.lockPaidCurrentAccess && (
            <CardContent>
              <Button asChild size="sm" variant="secondary">
                <Link href="/subscription">
                  {presentation.accessKind === "expired" ||
                  presentation.accessKind === "deactivated"
                    ? "Renew subscription"
                    : "My subscription"}
                </Link>
              </Button>
            </CardContent>
          )}
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Available test</CardTitle>
          <CardDescription>
            Current access only — historical eligibility is separate.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {nextTest ? (
            <div className="grid gap-2">
              <p className="font-medium">{nextTest.title}</p>
              <p className="text-sm text-muted-foreground">
                {subj?.name && `${subj.name} · `}
                {nextTest.question_count} MCQs · {nextTest.duration_minutes}{" "}
                minutes
              </p>
              <p className="text-sm text-muted-foreground">
                Available until{" "}
                {nextTest.closes_at && formatDateTime(nextTest.closes_at)}
              </p>
              {nextEntitled ? (
                <Button asChild className="w-fit">
                  <Link href={`/tests/${nextTest.id}/attempt`}>Start test</Link>
                </Button>
              ) : (
                <ResourceLockNotice compact />
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nothing available right now.{" "}
              <Link href="/tests" className="underline">
                See all tests
              </Link>
            </p>
          )}
        </CardContent>
      </Card>

      {presentation.showHistoricalPerformance && (
        <div>
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <h2 className="font-medium text-muted-foreground">
              Lifetime performance
            </h2>
            <p className="max-w-xl text-xs text-muted-foreground">
              {presentation.lifetime.grainNote}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat
              label={presentation.lifetime.attemptedLabel}
              value={String(presentation.lifetime.attempted)}
            />
            <Stat
              label={presentation.lifetime.averageLabel}
              value={`${presentation.lifetime.averagePercentage}%`}
            />
            <Stat
              label={presentation.lifetime.bestLabel}
              value={`${presentation.lifetime.bestPercentage}%`}
            />
            <Stat
              label={presentation.lifetime.rankLabel}
              value={
                presentation.lifetime.averageRank
                  ? `#${presentation.lifetime.averageRank}`
                  : "—"
              }
            />
          </div>
        </div>
      )}

      <div>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <h2 className="font-medium text-muted-foreground">
            Catalog participation
          </h2>
          <p className="max-w-xl text-xs text-muted-foreground">
            {presentation.catalog.scopeNote}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat
            label="Eligible (approx.)"
            value={String(presentation.catalog.eligibleApprox)}
          />
          <Stat
            label="Missed"
            value={String(presentation.catalog.missed)}
          />
          <Stat
            label="Not eligible"
            value={String(presentation.catalog.notEligible)}
          />
          <Stat
            label="Locked now"
            value={String(presentation.catalog.counts.locked)}
          />
        </div>
      </div>

      {presentation.paidFeatureLock.show && (
        <Card className="border-dashed">
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-base">
                {presentation.paidFeatureLock.title}
              </CardTitle>
              <Badge variant="outline">locked</Badge>
            </div>
            <CardDescription>
              {presentation.paidFeatureLock.body}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ResourceLockNotice compact />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Recent tests</CardTitle>
          <CardDescription>
            Submitted history — kept after subscription expiry.
          </CardDescription>
          {(recent ?? []).length === 0 && (
            <CardDescription>No tests taken yet.</CardDescription>
          )}
        </CardHeader>
        {(recent ?? []).length > 0 && (
          <CardContent className="grid gap-2">
            {((recent ?? []) as RecentTest[]).map((r) => (
              <Link
                key={r.test_id}
                href={`/tests/${r.test_id}/result`}
                className="flex items-center justify-between rounded-md border p-2 text-sm transition-colors hover:bg-accent/50"
              >
                <span>{r.title}</span>
                <div className="flex items-center gap-2">
                  <Badge>{r.percentage}%</Badge>
                  {r.rank != null && (
                    <span className="text-muted-foreground">Rank #{r.rank}</span>
                  )}
                </div>
              </Link>
            ))}
          </CardContent>
        )}
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}
