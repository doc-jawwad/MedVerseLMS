import { Suspense } from "react";
import Link from "next/link";
import { requireStudent } from "@/lib/auth/require-user";
import { formatDateTime } from "@/lib/utils";
import { buildStudentDashboardPresentation } from "@/lib/tests/student-dashboard-presentation";
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
import { StatusBadge } from "@/components/student/status-badge";
import { OpensCountdown } from "@/components/study/opens-countdown";
import { StudyMarkdown } from "@/components/study/study-markdown";
import { sortByOpensAtAsc } from "@/lib/study/upcoming";
import { DashboardAlerts } from "@/components/dashboard/dashboard-alerts";
import { buildDashboardAlerts } from "@/lib/dashboard/build-alerts";
import { deriveDashboardUpcomingFromCatalog } from "@/lib/dashboard/derive-upcoming-from-catalog";
import { DashboardLeaderboardSection } from "@/components/dashboard/dashboard-leaderboard-section";
import { DashboardHistoricalSection } from "@/components/dashboard/dashboard-historical-section";
import { DashboardPaidSection } from "@/components/dashboard/dashboard-paid-section";
import { DashboardRecentSection } from "@/components/dashboard/dashboard-recent-section";
import {
  DashboardHistoricalFallback,
  DashboardLeaderboardFallback,
  DashboardPaidFallback,
  DashboardRecentFallback,
} from "@/components/dashboard/dashboard-section-fallback";

export const metadata = { title: "Dashboard — MedVerse LMS" };

export default async function DashboardPage() {
  const { supabase, profile, enrollment, userId } = await requireStudent();
  await finalizeOwnExpiredAttempts(supabase);

  const now = new Date();
  const nowMs = now.getTime();

  // Shell fan-out only (v3). Deferred sections stream via Suspense:
  // leaderboard, historical, paid analytics, recent.
  // Live-subscription: request-local React.cache helper only (shared with layout).
  // Tests: one RLS-visible catalog fetch; upcoming is derived in-process (v2).
  const [
    hasLiveAccess,
    { data: catalogTests },
    { data: myAttempts },
    { data: accessible },
    { data: subscriptions },
    { data: applications },
    { data: grants },
    { data: prepRows },
  ] = await Promise.all([
    getStudentHasLiveSubscription(),
    supabase
      .from("tests")
      .select(
        "id, title, subjects(name), duration_minutes, opens_at, closes_at, question_count, entitlement, status"
      ),
    supabase
      .from("test_attempts")
      .select("test_id, state, expires_at")
      .eq("student_id", userId)
      .neq("state", "invalidated"),
    supabase.rpc("accessible_test_ids"),
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

  const upcoming = deriveDashboardUpcomingFromCatalog(
    catalogTests ?? [],
    nowMs
  );

  const paidDetails = studentHasPaidLmsSections(hasLiveAccess);

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
    hasLiveAccess,
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

  // Shell presentation: catalog + access banner only (lifetime deferred).
  const presentation = buildStudentDashboardPresentation({
    subscriptionKind: subView.kind,
    lifetime: null,
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

  const leaderboardCandidates = (catalogTests ?? []).map((t) => ({
    id: t.id as string,
    title: (t.title as string) ?? "",
    status: t.status as string,
    closes_at: (t.closes_at as string | null) ?? null,
    opens_at: (t.opens_at as string | null) ?? null,
    entitlement: (t.entitlement as string | null) ?? null,
  }));

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
            Scheduled and currently open tests for your class. The Tests page lists upcoming, available, in-progress, and previous tests.
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

      <Suspense fallback={<DashboardLeaderboardFallback />}>
        <DashboardLeaderboardSection
          candidates={leaderboardCandidates}
          nowMs={nowMs}
          viewerStudentId={userId}
        />
      </Suspense>

      <Suspense fallback={<DashboardHistoricalFallback />}>
        <DashboardHistoricalSection subscriptionKind={subView.kind} />
      </Suspense>

      {paidDetails ? (
        <Suspense fallback={<DashboardPaidFallback />}>
          <DashboardPaidSection />
        </Suspense>
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

      <Suspense fallback={<DashboardRecentFallback />}>
        <DashboardRecentSection />
      </Suspense>
    </StudentPage>
  );
}
