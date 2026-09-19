import Link from "next/link";
import { requireStudent } from "@/lib/auth/require-user";
import { formatDateTime } from "@/lib/utils";
import { buildStudentDashboardPresentation } from "@/lib/tests/student-dashboard-presentation";
import { classifyCatalogTestStates, isIncomingDashboardTest, testPricingLabel } from "@/lib/tests/student-test-state";
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
import { PageHeader } from "@/components/student/page-header";
import { StudentPage } from "@/components/student/student-page";
import { InstallMedverseApp } from "@/components/pwa/install-medverse-app";
import { StatTile } from "@/components/student/stat-tile";
import { SectionHeading } from "@/components/student/section-heading";
import { EmptyState } from "@/components/student/empty-state";
import { OpensCountdown } from "@/components/study/opens-countdown";
import { StudyMarkdown } from "@/components/study/study-markdown";
import { sortByOpensAtAsc } from "@/lib/study/upcoming";

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
    { data: prepRows },
  ] = await Promise.all([
    supabase.rpc("student_test_summary"),
    supabase.rpc("student_recent_tests", { p_limit: 5 }),
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
    supabase.rpc("accessible_test_prep"),
  ]);

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

  const incomingStates = classifyCatalogTestStates({
    nowMs: now.getTime(),
    tests: upcoming ?? [],
    attempts: myAttempts ?? [],
    accessibleIds: (accessible ?? []).map((row: { id: string }) => row.id),
    subscriptions: subRows.map((s) => ({
      starts_at: s.starts_at,
      ends_at: s.ends_at,
    })),
    grants: grants ?? [],
  });
  const incomingTests = sortByOpensAtAsc(upcoming ?? []).map((t) => {
    const idx = (upcoming ?? []).findIndex((row) => row.id === t.id);
    return { t, state: incomingStates[idx]! };
  }).filter(({ state }) => isIncomingDashboardTest(state));

  const recentRows = (recent ?? []) as RecentTest[];

  return (
    <StudentPage>
      <PageHeader
        eyebrow={enrollment.year_name}
        title={`Welcome, ${profile.full_name || "Student"}`}
        description="Incoming scheduled tests for your class, plus lifetime results."
      />

      <InstallMedverseApp variant="card" />

      {presentation.accessBanner && (
        <Card className="shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-[#072855]">
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

      <Card className="overflow-hidden shadow-none">
        <CardHeader className="border-b bg-[#072855] text-white">
          <CardTitle className="text-base text-white">Incoming tests</CardTitle>
          <CardDescription className="text-white/70">
            Scheduled and currently open tests for your class. History lives under Tests.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 pt-4">
          {incomingTests.length > 0 ? (
            incomingTests.map(({ t, state }) => {
              const subj = t.subjects as unknown as { name: string } | null;
              const pricing = testPricingLabel(t.entitlement);
              const canStart =
                (state === "available" || state === "in_progress") &&
                entitled.has(t.id);
              return (
                <div
                  key={t.id}
                  className="grid gap-2 rounded-xl border p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="font-heading text-lg font-semibold text-[#072855]">
                      {t.title}
                    </p>
                    <Badge variant={pricing === "FREE" ? "secondary" : "outline"}>
                      {pricing}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {subj?.name && `${subj.name} · `}
                    {t.question_count} MCQs · {t.duration_minutes} minutes
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {t.opens_at && <>Opens {formatDateTime(t.opens_at)} · </>}
                    {t.closes_at && <>Closes {formatDateTime(t.closes_at)}</>}
                  </p>
                  {state === "upcoming" && t.opens_at && (
                    <OpensCountdown opensAt={t.opens_at} />
                  )}
                  {entitled.has(t.id) && prepByTest.get(t.id) && (
                    <div className="rounded-lg border bg-muted/40 p-3">
                      <p className="mb-1 text-xs font-semibold tracking-wide text-[#05AEA9] uppercase">
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
                  ) : state === "locked" ||
                    (state === "available" && !entitled.has(t.id)) ? (
                    <ResourceLockNotice compact />
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

      <div className="grid gap-3">
        <SectionHeading
          title="Catalog participation"
          description={presentation.catalog.scopeNote}
        />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile
            label="Eligible (approx.)"
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

      {presentation.paidFeatureLock.show && (
        <Card className="border-dashed shadow-none">
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-base text-[#072855]">
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

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-base text-[#072855]">Recent tests</CardTitle>
          <CardDescription>
            Submitted history — kept after subscription expiry.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {recentRows.length === 0 ? (
            <EmptyState title="No tests taken yet." />
          ) : (
            <div className="grid gap-2">
              {recentRows.map((r) => (
                <Link
                  key={r.test_id}
                  href={`/tests/${r.test_id}/result`}
                  className="flex items-center justify-between rounded-xl border bg-card px-3 py-2.5 text-sm transition-colors hover:bg-accent/50"
                >
                  <span className="font-medium text-[#072855]">{r.title}</span>
                  <div className="flex items-center gap-2">
                    <Badge>{r.percentage}%</Badge>
                    {r.rank != null && (
                      <span className="text-muted-foreground">
                        Rank #{r.rank}
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </StudentPage>
  );
}
