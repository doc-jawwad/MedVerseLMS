import Link from "next/link";
import { requireStudent } from "@/lib/auth/require-user";
import { getPaymentInstructions } from "@/lib/actions/subscription-applications";
import { createSubscriptionClassAdapter } from "@/lib/profile/adapter";
import { formatDate, formatDateTime } from "@/lib/utils";
import {
  buildStudentSubscriptionView,
  remainingSubscriptionDays,
  type StudentApplicationRow,
  type StudentSubscriptionRow,
} from "@/lib/subscriptions/student-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SubscriptionApplyForm } from "./apply-form";
import { PageHeader } from "@/components/student/page-header";
import { StudentPage } from "@/components/student/student-page";
import { FieldRow } from "@/components/student/field-row";

export const metadata = { title: "My Subscription — MedVerse LMS" };

const PKT_TZ = "Asia/Karachi";

function formatPKT(iso: string): string {
  return new Date(iso).toLocaleDateString("en-PK", {
    timeZone: PKT_TZ,
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function remainingDaysPKT(endsAt: string): number {
  const now = new Date(
    new Date().toLocaleString("en-US", { timeZone: PKT_TZ })
  );
  const end = new Date(
    new Date(endsAt).toLocaleString("en-US", { timeZone: PKT_TZ })
  );
  const diffMs = end.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}

export default async function SubscriptionPage() {
  const { supabase, userId, enrollment } = await requireStudent();
  const classAdapter = createSubscriptionClassAdapter(supabase);

  await supabase.rpc("expire_due_subscriptions");

  const [liveRes, subsRes, appsRes, instructionsRes, yearsRes, plansRes, notifsRes] =
    await Promise.all([
      supabase.rpc("has_live_subscription"),
      supabase
        .from("subscriptions")
        .select(
          "id, status, starts_at, ends_at, grace_days, paid_access_mode, year_id, subscription_plans(name), years(name)"
        )
        .eq("student_id", userId)
        .order("ends_at", { ascending: false }),
      supabase
        .from("subscription_applications")
        .select(
          "id, status, amount, currency, created_at, review_note, reviewed_at, plan_id, year_id"
        )
        .eq("student_id", userId)
        .order("created_at", { ascending: false }),
      getPaymentInstructions(),
      classAdapter.listYears(),
      // RLS automatically filters to the student's enrolled year.
      supabase
        .from("subscription_plans")
        .select(
          "id, name, description, duration_days, price, is_complimentary, sort_order, year_id"
        )
        .eq("is_active", true)
        .order("sort_order")
        .order("name"),
      supabase
        .from("student_notifications")
        .select("id, kind, ref_id, payload, read_at, created_at")
        .eq("student_id", userId)
        .in("kind", ["application_approved", "application_rejected"])
        .is("read_at", null)
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

  const subscriptions: StudentSubscriptionRow[] = (subsRes.data ?? []).map(
    (row) => {
      const plan = row.subscription_plans as unknown as
        | { name: string }
        | null
        | { name: string }[];
      const planName = Array.isArray(plan)
        ? (plan[0]?.name ?? null)
        : (plan?.name ?? null);
      return {
        id: row.id,
        status: row.status as StudentSubscriptionRow["status"],
        starts_at: row.starts_at,
        ends_at: row.ends_at,
        grace_days: row.grace_days ?? 0,
        paid_access_mode: row.paid_access_mode,
        plan_name: planName,
      };
    }
  );

  const applications: StudentApplicationRow[] = (appsRes.data ?? []).map(
    (row) => ({
      id: row.id,
      status: row.status,
      amount: Number(row.amount),
      currency: row.currency,
      created_at: row.created_at,
      review_note: row.review_note,
      reviewed_at: row.reviewed_at,
    })
  );

  const view = buildStudentSubscriptionView({
    hasLiveAccess: Boolean(liveRes.data),
    subscriptions,
    applications,
  });

  const instructions =
    "instructions" in instructionsRes
      ? (instructionsRes.instructions as Parameters<
          typeof SubscriptionApplyForm
        >[0]["instructions"])
      : null;
  const instructionsError =
    "error" in instructionsRes ? instructionsRes.error : null;

  const showApply =
    view.kind === "none" ||
    view.kind === "expired" ||
    view.kind === "deactivated" ||
    (view.kind === "pending" && view.pending);

  const applyMode = view.pending ? "edit" : "create";
  // Purchase class must match active enrollment — RPC rejects other years.
  const years = (yearsRes.ok ? yearsRes.data : []).filter(
    (y) => !enrollment?.year_id || y.id === enrollment.year_id
  );
  // Complimentary plans are admin-assigned; students apply paid plans only.
  const plans = (plansRes.data ?? [])
    .filter((p) => !p.is_complimentary)
    .map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      duration_days: p.duration_days,
      price: p.price,
      is_complimentary: p.is_complimentary,
      year_id: p.year_id as string,
    }));
  const notifications = notifsRes.data ?? [];
  if (notifications.length > 0) {
    const ids = notifications.map((n) => n.id);
    await supabase
      .from("student_notifications")
      .update({ read_at: new Date().toISOString() })
      .in("id", ids)
      .eq("student_id", userId);
  }
  const pendingPlanId =
    (appsRes.data ?? []).find((a) => a.status === "pending")?.plan_id ?? null;

  // Compute PKT-aware remaining days for active subscription.
  const activeSub = view.active;
  const remainingDays = activeSub
    ? remainingDaysPKT(activeSub.ends_at)
    : null;

  // Year name for active subscription.
  const activeSubRow = subsRes.data?.find((s) => s.id === activeSub?.id);
  const activeYearName =
    (activeSubRow?.years as unknown as { name: string } | null)?.name ?? null;

  return (
    <StudentPage width="narrow">
      <PageHeader
        title="My Subscription"
        description="Free resources stay available. Subscription-required resources stay visible but locked until you have an active subscription."
      />

      {notifications.length > 0 && (
        <div className="grid gap-2">
          {notifications.map((n) => {
            const payload = (n.payload ?? {}) as Record<string, unknown>;
            if (n.kind === "application_approved") {
              return (
                <div
                  key={n.id}
                  className="flex items-start gap-3 rounded-md border border-green-200 bg-green-50 p-3 text-sm dark:border-green-900 dark:bg-green-950/30"
                >
                  <span className="text-green-600 dark:text-green-400">✓</span>
                  <div>
                    <p className="font-medium">Application approved</p>
                    {Boolean(payload.plan_name) && (
                      <p className="text-muted-foreground">
                        Plan: {String(payload.plan_name)}
                      </p>
                    )}
                  </div>
                </div>
              );
            }
            if (n.kind === "application_rejected") {
              return (
                <div
                  key={n.id}
                  className="flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm"
                >
                  <span className="text-destructive">✗</span>
                  <div>
                    <p className="font-medium">Application rejected</p>
                    {Boolean(payload.review_note) && (
                      <p className="text-muted-foreground">
                        {String(payload.review_note)}
                      </p>
                    )}
                  </div>
                </div>
              );
            }
            return null;
          })}
        </div>
      )}

      <Card className="surface-card border-border/80 shadow-none">
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-base text-[var(--student-ink)]">
            {view.label}
            <Badge
              variant={
                view.kind === "active"
                  ? "default"
                  : view.kind === "pending"
                    ? "secondary"
                    : "outline"
              }
            >
              {view.kind}
            </Badge>
          </CardTitle>
          <CardDescription>{view.description}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          {view.kind === "active" && view.active && (
            <div className="grid gap-2">
              <FieldRow label="Plan">{view.active.plan_name ?? "—"}</FieldRow>
              {activeYearName && (
                <FieldRow label="Class">{activeYearName}</FieldRow>
              )}
              <FieldRow label="Starts">{formatPKT(view.active.starts_at)}</FieldRow>
              <FieldRow label="Ends">{formatPKT(view.active.ends_at)}</FieldRow>
              {remainingDays != null && (
                <FieldRow label="Remaining">
                  <span
                    className={
                      remainingDays <= 7
                        ? "font-medium text-destructive"
                        : undefined
                    }
                  >
                    {remainingDays === 0
                      ? "Ends today"
                      : `${remainingDays} day${remainingDays === 1 ? "" : "s"}`}
                  </span>
                </FieldRow>
              )}
            </div>
          )}

          {view.pending && (
            <div className="grid gap-2 rounded-md border bg-muted/30 p-3">
              <p className="font-medium">Pending application</p>
              <FieldRow label="Amount">
                {`${view.pending.amount} ${view.pending.currency}`}
              </FieldRow>
              <FieldRow label="Submitted">
                {formatDateTime(view.pending.created_at)}
              </FieldRow>
              <FieldRow label="Status">
                <Badge variant="secondary">pending</Badge>
              </FieldRow>
            </div>
          )}

          {view.latestNonPendingApplication?.status === "rejected" &&
            !view.pending && (
              <div className="grid gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
                <p className="font-medium">Previous application rejected</p>
                <FieldRow label="Amount">
                  {`${view.latestNonPendingApplication.amount} ${view.latestNonPendingApplication.currency}`}
                </FieldRow>
                <FieldRow label="Submitted">
                  {formatDateTime(view.latestNonPendingApplication.created_at)}
                </FieldRow>
                {view.latestNonPendingApplication.reviewed_at && (
                  <FieldRow label="Reviewed">
                    {formatDateTime(
                      view.latestNonPendingApplication.reviewed_at
                    )}
                  </FieldRow>
                )}
                {view.latestNonPendingApplication.review_note?.trim() ? (
                  <div className="grid gap-1">
                    <span className="text-muted-foreground">Review note</span>
                    <p className="whitespace-pre-wrap">
                      {view.latestNonPendingApplication.review_note}
                    </p>
                  </div>
                ) : null}
                <p className="text-muted-foreground">
                  This record is kept as history. Submit a new application
                  below — it will not overwrite the rejected one.
                </p>
              </div>
            )}

          {view.kind === "active" && (
            <p className="text-muted-foreground">
              Need help?{" "}
              <Link href="#contact-admin" className="underline">
                Contact Admin
              </Link>
            </p>
          )}
        </CardContent>
      </Card>

      {plans.length > 0 && view.kind !== "active" && (
        <Card className="surface-card border-border/80 shadow-none">
          <CardHeader>
            <CardTitle className="text-base text-[var(--student-ink)]">
              Available plans
            </CardTitle>
            <CardDescription>
              Plans for your enrolled class. Prices are in PKR unless otherwise
              noted.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3">
              {plans.map((plan) => {
                const approxMonths = Math.round(plan.duration_days / 30);
                return (
                  <div
                    key={plan.id}
                    className="flex items-center justify-between rounded-md border p-3"
                  >
                    <div>
                      <p className="font-medium">{plan.name}</p>
                      {plan.description ? (
                        <p className="text-xs text-muted-foreground">
                          {plan.description}
                        </p>
                      ) : null}
                      <p className="text-xs text-muted-foreground">
                        {approxMonths} month{approxMonths !== 1 ? "s" : ""}{" "}
                        ({plan.duration_days} days)
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">
                        {Number(plan.price).toLocaleString()} PKR
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {showApply && (
        <Card className="surface-card border-border/80 shadow-none">
          <CardHeader>
            <CardTitle className="text-base text-[var(--student-ink)]">
              {applyMode === "edit"
                ? "Edit pending application"
                : "Get Subscription"}
            </CardTitle>
            <CardDescription>
              {applyMode === "edit"
                ? "Update the amount or replace the payment screenshot while review is pending. Purchase class stays locked for the pending period."
                : "Confirm the class you are purchasing, transfer the fee, then upload your payment screenshot for admin review."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SubscriptionApplyForm
              instructions={instructions}
              instructionsError={instructionsError}
              mode={applyMode}
              pendingApplicationId={view.pending?.id}
              initialAmount={view.pending?.amount}
              currency={view.pending?.currency ?? "PKR"}
              years={years}
              defaultYearId={enrollment.year_id}
              plans={plans}
              initialPlanId={pendingPlanId}
            />
          </CardContent>
        </Card>
      )}

      <Card id="contact-admin" className="surface-card border-border/80 shadow-none">
        <CardHeader>
          <CardTitle className="text-base text-[var(--student-ink)]">Contact Admin</CardTitle>
          <CardDescription>
            There is no in-app messaging. Reach your academy admin the same way
            you usually do (WhatsApp / email / office) if you need help with
            payment, access, or a rejected application.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" size="sm">
            <Link href="/profile">Back to My Account</Link>
          </Button>
        </CardContent>
      </Card>
    </StudentPage>
  );
}
