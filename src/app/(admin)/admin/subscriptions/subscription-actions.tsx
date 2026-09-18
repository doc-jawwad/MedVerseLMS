"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  extendSubscription,
  setSubscriptionEnd,
  deactivateSubscription,
  restoreSubscription,
  assignSubscriptionPlan,
  activateSubscription,
  setSubscriptionAccess,
} from "@/lib/actions/subscriptions";
import { adminSubscriptionErrorMessage } from "@/lib/subscriptions/admin-errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type PlanOption = { id: string; name: string; duration_days: number };

type Props = {
  subscriptionId: string | null;
  studentId: string;
  status: string | null;
  isLive: boolean;
  accountStatus: string;
  canManage: boolean;
  plans: PlanOption[];
  graceDays?: number;
  paidAccessMode?: string;
};

type DialogMode =
  | null
  | "extend"
  | "setEnd"
  | "deactivate"
  | "restore"
  | "assign"
  | "activate"
  | "access";

export function SubscriptionActions({
  subscriptionId,
  studentId,
  status,
  isLive,
  accountStatus,
  canManage,
  plans,
  graceDays = 0,
  paidAccessMode = "all_entitled",
}: Props) {
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<DialogMode>(null);
  const [days, setDays] = useState("30");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [planId, setPlanId] = useState(plans[0]?.id ?? "");
  const [grace, setGrace] = useState(String(graceDays));
  const [accessMode, setAccessMode] = useState(paidAccessMode || "all_entitled");

  if (!canManage) return null;

  const accountBlocked = ["restricted", "suspended", "deactivated", "revoked"].includes(
    accountStatus
  );

  function run() {
    const m = mode;
    if (!m) return;
    setMode(null);
    startTransition(async () => {
      let res: { error?: string } = {};
      if (m === "activate") {
        if (!planId) {
          toast.error("Select a plan");
          return;
        }
        res = await activateSubscription(
          studentId,
          planId,
          startsAt ? new Date(startsAt).toISOString() : null,
          endsAt ? new Date(endsAt).toISOString() : null,
          Number(grace),
          accessMode
        );
      } else if (!subscriptionId) {
        toast.error(adminSubscriptionErrorMessage("subscription_not_found"));
        return;
      } else if (m === "extend") {
        const n = Number(days);
        res = await extendSubscription(
          subscriptionId,
          Number.isFinite(n) && n > 0 ? n : null
        );
      } else if (m === "setEnd") {
        if (!endsAt) {
          toast.error("Choose an end date");
          return;
        }
        res = await setSubscriptionEnd(
          subscriptionId,
          new Date(endsAt).toISOString()
        );
      } else if (m === "deactivate") {
        res = await deactivateSubscription(subscriptionId);
      } else if (m === "restore") {
        res = await restoreSubscription(subscriptionId);
      } else if (m === "assign") {
        if (!planId) {
          toast.error("Select a plan");
          return;
        }
        res = await assignSubscriptionPlan(subscriptionId, planId);
      } else if (m === "access") {
        res = await setSubscriptionAccess(
          subscriptionId,
          Number(grace),
          accessMode
        );
      }
      if (res.error) toast.error(adminSubscriptionErrorMessage(res.error));
      else toast.success("Subscription updated");
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" disabled={pending}>
            {pending ? "Working…" : "Manage"}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {!subscriptionId || status !== "active" || !isLive ? (
            <DropdownMenuItem
              disabled={accountBlocked || plans.length === 0}
              onClick={() => setMode("activate")}
            >
              Activate subscription
            </DropdownMenuItem>
          ) : null}
          {isLive && subscriptionId && (
            <>
              <DropdownMenuItem onClick={() => setMode("extend")}>
                Extend / renew
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setMode("setEnd")}>
                Set end date
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setMode("assign")}>
                Assign plan
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setGrace(String(graceDays));
                  setAccessMode(paidAccessMode || "all_entitled");
                  setMode("access");
                }}
              >
                Grace / paid access
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setMode("deactivate")}>
                Deactivate
              </DropdownMenuItem>
            </>
          )}
          {status === "deactivated" && subscriptionId && (
            <DropdownMenuItem onClick={() => setMode("restore")}>
              Restore
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={mode != null} onOpenChange={(o) => !o && setMode(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {mode === "extend" && "Extend subscription"}
              {mode === "setEnd" && "Set end date"}
              {mode === "deactivate" && "Deactivate subscription"}
              {mode === "restore" && "Restore subscription"}
              {mode === "assign" && "Assign plan"}
              {mode === "activate" && "Activate subscription"}
              {mode === "access" && "Grace and paid access"}
            </DialogTitle>
            <DialogDescription>
              {accountBlocked
                ? `Account status is "${accountStatus}". Subscription changes do not restore LMS access until the account is active again.`
                : "Uses the existing permissioned RPC. Account status is not changed by this action."}
            </DialogDescription>
          </DialogHeader>

          {(mode === "extend") && (
            <div className="grid gap-2">
              <Label htmlFor="days">Days to add</Label>
              <Input
                id="days"
                type="number"
                min={1}
                value={days}
                onChange={(e) => setDays(e.target.value)}
              />
            </div>
          )}
          {mode === "setEnd" && (
            <div className="grid gap-2">
              <Label htmlFor="ends">New end date/time (local)</Label>
              <Input
                id="ends"
                type="datetime-local"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
              />
            </div>
          )}
          {(mode === "assign" || mode === "activate") && (
            <div className="grid gap-2">
              <Label htmlFor="plan">Plan</Label>
              <select
                id="plan"
                className="flex h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                value={planId}
                onChange={(e) => setPlanId(e.target.value)}
              >
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.duration_days}d)
                  </option>
                ))}
              </select>
            </div>
          )}
          {mode === "activate" && (
            <>
              <div className="grid gap-2">
                <Label htmlFor="starts">Start (optional)</Label>
                <Input
                  id="starts"
                  type="datetime-local"
                  value={startsAt}
                  onChange={(e) => setStartsAt(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="activate-end">End (optional)</Label>
                <Input
                  id="activate-end"
                  type="datetime-local"
                  value={endsAt}
                  onChange={(e) => setEndsAt(e.target.value)}
                />
              </div>
            </>
          )}
          {(mode === "activate" || mode === "access") && (
            <>
              <div className="grid gap-2">
                <Label htmlFor="grace">Grace days</Label>
                <select
                  id="grace"
                  className="flex h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                  value={grace}
                  onChange={(e) => setGrace(e.target.value)}
                >
                  <option value="0">0</option>
                  <option value="1">1</option>
                  <option value="2">2</option>
                </select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="access-mode">Paid resources</Label>
                <select
                  id="access-mode"
                  className="flex h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                  value={accessMode}
                  onChange={(e) => setAccessMode(e.target.value)}
                >
                  <option value="all_entitled">All entitled paid resources</option>
                  <option value="grants_only">Only explicitly granted resources</option>
                </select>
              </div>
            </>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setMode(null)}>
              Cancel
            </Button>
            <Button
              variant={mode === "deactivate" ? "destructive" : "default"}
              onClick={run}
              disabled={accountBlocked && mode === "activate"}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
