import Link from "next/link";
import { requireStudent } from "@/lib/auth/require-user";
import { getPaymentInstructions } from "@/lib/actions/subscription-applications";
import { createSubscriptionClassAdapter } from "@/lib/profile/adapter";
import { formatDate, formatDateTime } from "@/lib/utils";
import {
  buildStudentSubscriptionView,
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

export default async function SubscriptionPage() {
  const { supabase, userId, enrollment } = await requireStudent();
  const classAdapter = createSubscriptionClassAdapter(supabase);

  await supabase.rpc("expire_due_subscriptions");

  const [liveRes, subsRes, appsRes, instructionsRes, yearsRes] =
    await Promise.all([
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
      getPaymentInstructions(),
      classAdapter.listYears(),
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
  const years = yearsRes.ok ? yearsRes.data : [];

  return (
    <StudentPage width="narrow">
      <PageHeader
        title="My Subscription"
        description="Free resources stay available. Subscription-required resources stay visible but locked until you have an active subscription."
      />

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-base text-[#072855]">
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
              <FieldRow label="Starts">{formatDate(view.active.starts_at)}</FieldRow>
              <FieldRow label="Ends">{formatDate(view.active.ends_at)}</FieldRow>
              {view.remainingDays != null && (
                <FieldRow label="Remaining">
                  {view.remainingDays === 0
                    ? "Ends today"
                    : `${view.remainingDays} day${view.remainingDays === 1 ? "" : "s"}`}
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

      {showApply && (
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="text-base text-[#072855]">
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
            />
          </CardContent>
        </Card>
      )}

      <Card id="contact-admin" className="shadow-none">
        <CardHeader>
          <CardTitle className="text-base text-[#072855]">Contact Admin</CardTitle>
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
