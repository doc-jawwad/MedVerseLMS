import Link from "next/link";
import { requireStudent } from "@/lib/auth/require-user";
import { formatDateTime } from "@/lib/utils";
import {
  buildStudentDashboardPresentation,
  PERFORMANCE_GRAIN_COPY,
} from "@/lib/tests/student-dashboard-presentation";
import {
  classifyCatalogTestStates,
  displayTestTitle,
  formatMcqCount,
  isIncomingDashboardTest,
  testPricingLabel,
} from "@/lib/tests/student-test-state";
import { finalizeOwnExpiredAttempts } from "@/lib/tests/finalize-own-expired";
import { buildStudentSubscriptionView } from "@/lib/subscriptions/student-status";
import { studentHasPaidLmsSections } from "@/lib/subscriptions/student-section-access";
import { getStudentHasLiveSubscription } from "@/lib/subscriptions/student-live-access";
import { ResourceLockNotice } from "@/components/subscription/resource-lock-notice";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/student/page-header";
import { StudentPage } from "@/components/student/student-page";
import { StatTile } from "@/components/student/stat-tile";
import { SectionHeading } from "@/components/student/section-heading";
import { EmptyState } from "@/components/student/empty-state";
import { ProgressBar } from "@/components/student/progress-bar";
import { StatusBadge } from "@/components/student/status-badge";
import { ActivityItem } from "@/components/student/activity-item";
import { OpensCountdown } from "@/components/study/opens-countdown";
import { StudyMarkdown } from "@/components/study/study-markdown";
import { sortByOpensAtAsc } from "@/lib/study/upcoming";
import { DashboardAlerts } from "@/components/dashboard/dashboard-alerts";
import { LeaderboardBoardCard } from "@/components/dashboard/leaderboard-board-card";
import { DashboardPerformanceGraphs } from "@/components/dashboard/performance-graphs";
import { buildDashboardAlerts } from "@/lib/dashboard/build-alerts";
import {
  adaptLifetimeSummaryBars,
  adaptStudentTrendForChart,
} from "@/lib/dashboard/trend-chart-adapter";
import {
  dashboardFullLimit,
  loadLastCompletedLeaderboardBoard,
} from "@/lib/leaderboard/load-last-completed-board";
import { LEADERBOARD_PROJECTION_LIMITS } from "@/lib/leaderboard/projection-contract";

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

type SubjectPerf = {
  subject_id: string;
  subject_name: string;
  test_average_percentage: number;
  tests_taken: number;
  practice_accuracy: number;
  practice_answered: number;
};

type WeakChapter = {
  chapter_id: string;
  chapter_name: string;
  subject_name: string;
  accuracy: number;
  answered: number;
};

export default async function DashboardPage() {
  const { supabase, profile, enrollment, userId } = await requireStudent();
  await finalizeOwnExpiredAttempts(supabase);
  const hasLiveAccess = await getStudentHasLiveSubscription();
  const paidDetails = studentHasPaidLmsSections(hasLiveAccess);

  const now = new Date();
  const nowIso = now.toISOString();
  const nowMs = now.getTime();

  const [
    { data: summary },
    { data: recent },
    { data: trend },
    { data: upcoming },
    { data: catalogTests },
    { data: myAttempts },
    { data: accessible },
    { data: liveSub },
    { data: subscriptions },
    { data: applications },
    { data: grants },
    { data: prepRows },
  ] = await Promise.all([
    supabase.rpc("student_test_summary"),
    supabase.rpc("student_recent_tests", { p_limit: 5 }),
    supabase.rpc("student_trend"),
    supabase
      .from("tests")
      .select(
        "id, title, subjects(name), duration_minutes, opens_at, closes_at, question_count, entitlement, status"
      )
      .eq("status", "published")
      .gt("closes_at", nowIso)
      .order("opens_at", { ascending: true })
      .limit(20),
    supabase
      .from("tests")
      .select("id, title, status, opens_at, closes_at, entitlement"),
    supabase
      .from("test_attempts")
      .select("test_id, state, expires_at")
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
    supabase.rpc("accessible_test_prep"),
  ]);

  // Paid-only: subject performance and weak chapters (skip fetch for free students)
  let subjectRows: SubjectPerf[] = [];
  let weakRows: WeakChapter[] = [];
  if (paidDetails) {
    const [{ data: subjects }, { data: weak }] = await Promise.all([
      supabase.rpc("student_subject_performance"),
      supabase.rpc("student_weak_chapters", { p_limit: 5 }),
    ]);
    subjectRows = (subjects ?? []) as SubjectPerf[];
    weakRows = (weak ?? []) as WeakChapter[];
  }

  const prepByTest = new Map(
    ((prepRows ?? []) as { test_id: string; body_text: string }[]).map((row) => [
      row.test_id,
      row.body_text,
    ])
  );
  const entitled = new Set(
    (accessible ?? []).map((row: { id: string }) => row.id)
  );

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
    nowMs,
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

  const incomingStates = classifyCatalogTestStates({
    nowMs,
    tests: upcoming ?? [],
    attempts: myAttempts ?? [],
    accessibleIds: (accessible ?? []).map((row: { id: string }) => row.id),
    subscriptions: subRows.map((s) => ({
      starts_at: s.starts_at,
      ends_at: s.ends_at,
    })),
    grants: grants ?? [],
  });
  const incomingTests = sortByOpensAtAsc(upcoming ?? [])
    .map((t) => {
      const idx = (upcoming ?? []).findIndex((row) => row.id === t.id);
      return { t, state: incomingStates[idx]! };
    })
    .filter(({ state }) => isIncomingDashboardTest(state));

  const alerts = buildDashboardAlerts({
    accessKind: presentation.accessKind,
    accessBanner: presentation.accessBanner,
    incoming: incomingTests.map(({ t, state }) => ({
      id: t.id,
      title: t.title,
      opens_at: t.opens_at,
      state,
    })),
    nowMs,
  });

  // Fetch up to 20 rows server-side; the card renders Top 5 initially with a
  // client-side "View Full Leaderboard" toggle to reveal up to Top 20.
  const leaderboardBoard = await loadLastCompletedLeaderboardBoard(supabase, {
    candidates: (catalogTests ?? []).map((t) => ({
      id: t.id as string,
      title: (t.title as string) ?? "",
      status: t.status as string,
      closes_at: (t.closes_at as string | null) ?? null,
      opens_at: (t.opens_at as string | null) ?? null,
      entitlement: (t.entitlement as string | null) ?? null,
    })),
    nowMs,
    limit: dashboardFullLimit(),
  });

  const trendSeries = adaptStudentTrendForChart(trend);
  const summaryBars = adaptLifetimeSummaryBars(s);
  const recentRows = (recent ?? []) as RecentTest[];

  return (
    <StudentPage>
      <PageHeader
        eyebrow={enrollment.year_name}
        title={`Welcome, ${profile.full_name || "Student"}`}
        description="Incoming tests, your performance, and the last-test leaderboard — all in one place."
      />

      <DashboardAlerts alerts={alerts} />

      <Card className="surface-card overflow-hidden border-border/80 shadow-none">
        <CardHeader className="surface-tint border-b border-border/80">
          <CardTitle className="font-heading text-base text-ink">
            Incoming tests
          </CardTitle>
          <CardDescription>
            Scheduled and currently open tests for your class. History lives under Tests.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 pt-4">
          {incomingTests.length > 0 ? (
            incomingTests.map(({ t, state }) => {
              const subj = t.subjects as unknown as { name: string } | null;
              const pricing = testPricingLabel(t.entitlement);
              const isEntitled = entitled.has(t.id);
              const canStart =
                state === "in_progress" ||
                (state === "available" && isEntitled);
              const showSubscriptionLock =
                !isEntitled &&
                state !== "in_progress" &&
                (state === "locked" ||
                  state === "available" ||
                  state === "upcoming");
              return (
                <div
                  key={t.id}
                  className="grid gap-2 rounded-xl border border-border/80 bg-card/60 p-3.5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="font-heading text-lg font-semibold text-ink">
                      {displayTestTitle(t.title, pricing)}
                    </p>
                    <StatusBadge tone={pricing === "FREE" ? "info" : "muted"}>
                      {pricing}
                    </StatusBadge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {subj?.name && `${subj.name} · `}
                    {formatMcqCount(t.question_count)} · {t.duration_minutes}{" "}
                    minutes
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {t.opens_at && <>Opens {formatDateTime(t.opens_at)} · </>}
                    {t.closes_at && <>Closes {formatDateTime(t.closes_at)}</>}
                  </p>
                  {state === "upcoming" && t.opens_at && (
                    <OpensCountdown opensAt={t.opens_at} />
                  )}
                  {isEntitled && prepByTest.get(t.id) && (
                    <div className="rounded-lg border bg-muted/40 p-3">
                      <p className="mb-1 text-xs font-semibold tracking-wide text-brand-ink uppercase">
                        Preparation
                      </p>
                      <StudyMarkdown source={prepByTest.get(t.id)!} />
                    </div>
                  )}
                  {canStart ? (
                    <Button asChild className="w-fit" size="sm">
                      <Link href={`/tests/${t.id}/attempt`}>
                        {state === "in_progress" ? "Resume test" : "Start test"}
                      </Link>
                    </Button>
                  ) : showSubscriptionLock ? (
                    <ResourceLockNotice />
                  ) : null}
                </div>
              );
            })
          ) : (
            <EmptyState
              title="Nothing incoming right now"
              description="When a test is scheduled for your class, it will appear here with date, time, and countdown."
              action={
                <Button asChild variant="outline" size="sm">
                  <Link href="/tests">See test history</Link>
                </Button>
              }
            />
          )}
        </CardContent>
      </Card>

      <LeaderboardBoardCard
        title="Last test leaderboard"
        description="Top 5 from the most recently completed formal test. Free and paid students can view this board."
        board={leaderboardBoard}
        viewerStudentId={userId}
        initialDisplayCount={LEADERBOARD_PROJECTION_LIMITS.dashboardTop}
      />

      {presentation.showHistoricalPerformance && (
        <div className="grid gap-3">
          <SectionHeading
            title="Lifetime performance"
            description={presentation.lifetime.grainNote}
          />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile
              label={presentation.lifetime.attemptedLabel}
              value={String(presentation.lifetime.attempted)}
            />
            <StatTile
              label={presentation.lifetime.averageLabel}
              value={`${presentation.lifetime.averagePercentage}%`}
            />
            <StatTile
              label={presentation.lifetime.bestLabel}
              value={`${presentation.lifetime.bestPercentage}%`}
            />
            <StatTile
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

      <DashboardPerformanceGraphs trend={trendSeries} summary={summaryBars} />

      {paidDetails ? (
        <>
          {subjectRows.length > 0 && (
            <Card className="surface-card border-border/80 shadow-none">
              <CardHeader>
                <CardTitle className="font-heading text-base text-ink">
                  Subject performance
                </CardTitle>
                <CardDescription>{PERFORMANCE_GRAIN_COPY.subject}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-5">
                {subjectRows.map((sub) => (
                  <div key={sub.subject_id} className="grid gap-3">
                    <p className="text-sm font-semibold text-ink">
                      {sub.subject_name}
                    </p>
                    <ProgressBar
                      label={`Tests (${sub.tests_taken})`}
                      value={sub.test_average_percentage}
                    />
                    <ProgressBar
                      label={`Practice (${sub.practice_answered} answered)`}
                      value={sub.practice_accuracy}
                    />
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {weakRows.length > 0 && (
            <Card className="surface-card border-border/80 shadow-none">
              <CardHeader>
                <CardTitle className="font-heading text-base text-ink">
                  Weak chapters
                </CardTitle>
                <CardDescription>{PERFORMANCE_GRAIN_COPY.weakChapters}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2">
                {weakRows.map((w) => (
                  <div
                    key={w.chapter_id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border/80 px-3 py-2 text-sm"
                  >
                    <span>
                      {w.chapter_name}{" "}
                      <span className="text-muted-foreground">
                        ({w.subject_name})
                      </span>
                    </span>
                    <StatusBadge tone={w.accuracy < 50 ? "danger" : "warning"}>
                      {w.accuracy}% ({w.answered})
                    </StatusBadge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      ) : (
        <Card className="surface-card border-dashed border-border/80 shadow-none">
          <CardHeader>
            <CardTitle className="font-heading text-base text-ink">
              Subject &amp; practice analytics
            </CardTitle>
            <CardDescription>
              Subject bars and weak chapters unlock with a live subscription.
              Lifetime score graphs and leaderboard are always available.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {/* ResourceLockNotice provides the single locked badge + /subscription CTA */}
            <ResourceLockNotice compact />
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3">
        <SectionHeading
          title="Your tests at a glance"
          description={presentation.catalog.scopeNote}
        />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile
            label="Listed for you"
            value={String(presentation.catalog.eligibleApprox)}
          />
          <StatTile
            label="Missed"
            value={String(presentation.catalog.missed)}
          />
          <StatTile
            label="Not eligible"
            value={String(presentation.catalog.notEligible)}
          />
          <StatTile
            label="Locked now"
            value={String(presentation.catalog.counts.locked)}
          />
        </div>
      </div>

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
    </StudentPage>
  );
}
