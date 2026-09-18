"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  promoteStudent,
  getStudentAccess,
  grantPracticeSubject,
  grantResourceAccess,
  revokeGrant,
  restrictResourceAccess,
  unrestrictResourceAccess,
} from "@/lib/actions/enrollment";
import {
  setAccountStatus,
  type AccountStatusAction,
  type AttemptDisposition,
} from "@/lib/actions/account";
import {
  BLOCKING_ACCOUNT_ACTIONS,
  EXAM_DISPOSITIONS,
  accountStatusErrorMessage,
  canSubmitAccountStatusChange,
  studentManageMenuItems,
} from "@/lib/admin/student-account-ui";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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

type Props = {
  studentId: string;
  yearId: string | null;
  hasActiveClass: boolean;
  accountStatus: string;
  hasInProgressExam: boolean;
};

type AccessData = {
  subjects: { id: string; name: string }[];
  tests: { id: string; title: string }[];
  folders: { id: string; name: string }[];
  grants: {
    id: string;
    grant_type: string;
    subject_id: string | null;
    test_id?: string | null;
    folder_id?: string | null;
  }[];
  restrictions: {
    id: string;
    resource_kind: string;
    subject_id: string | null;
    test_id: string | null;
    folder_id: string | null;
  }[];
};

type ConfirmState =
  | {
      kind: "simple";
      label: string;
      description: string;
      run: () => Promise<{ error?: string }>;
    }
  | {
      kind: "account";
      label: string;
      description: string;
      nextStatus: AccountStatusAction;
    };

export function StudentManageActions({
  studentId,
  yearId,
  hasActiveClass,
  accountStatus,
  hasInProgressExam,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [disposition, setDisposition] =
    useState<AttemptDisposition>("leave_in_progress");
  const [reason, setReason] = useState("");
  const [accessOpen, setAccessOpen] = useState(false);
  const [access, setAccess] = useState<AccessData | null>(null);

  const menu = useMemo(
    () =>
      studentManageMenuItems({
        accountStatus,
        hasActiveClass,
        hasYearForResources: Boolean(yearId),
      }),
    [accountStatus, hasActiveClass, yearId]
  );

  async function openAccess() {
    if (!yearId) return;
    setAccessOpen(true);
    setAccess(await getStudentAccess(studentId, yearId));
  }

  async function togglePractice(subjectId: string, granted: boolean) {
    const existing = access?.grants.find(
      (g) => g.grant_type === "practice_subject" && g.subject_id === subjectId
    );
    const res = granted
      ? await grantPracticeSubject(studentId, subjectId)
      : existing
        ? await revokeGrant(existing.id)
        : { error: undefined };
    if (res.error) toast.error(res.error);
    if (yearId) setAccess(await getStudentAccess(studentId, yearId));
  }

  async function toggleGrant(
    kind: "test" | "materials_folder",
    id: string,
    granted: boolean
  ) {
    const existing = access?.grants.find((g) =>
      kind === "test"
        ? g.grant_type === "test" && g.test_id === id
        : g.grant_type === "materials_folder" && g.folder_id === id
    );
    const res = granted
      ? await grantResourceAccess(
          studentId,
          kind,
          kind === "test" ? { testId: id } : { folderId: id }
        )
      : existing
        ? await revokeGrant(existing.id)
        : { error: undefined };
    if (res.error) toast.error(res.error);
    if (yearId) setAccess(await getStudentAccess(studentId, yearId));
  }

  async function toggleRestrict(
    kind: "practice_subject" | "test" | "materials_folder",
    id: string,
    blocked: boolean
  ) {
    const existing = access?.restrictions.find((r) => {
      if (r.resource_kind !== kind) return false;
      if (kind === "practice_subject") return r.subject_id === id;
      if (kind === "test") return r.test_id === id;
      return r.folder_id === id;
    });
    const res = blocked
      ? await restrictResourceAccess(
          studentId,
          kind,
          kind === "practice_subject"
            ? { subjectId: id }
            : kind === "test"
              ? { testId: id }
              : { folderId: id }
        )
      : existing
        ? await unrestrictResourceAccess(existing.id)
        : { error: undefined };
    if (res.error) toast.error(res.error);
    if (yearId) setAccess(await getStudentAccess(studentId, yearId));
  }

  function executeSimple() {
    if (!confirm || confirm.kind !== "simple") return;
    const c = confirm;
    setConfirm(null);
    startTransition(async () => {
      const { error } = await c.run();
      if (error) toast.error(error);
      else toast.success(`${c.label} done`);
    });
  }

  function executeAccount() {
    if (!confirm || confirm.kind !== "account") return;
    const nextStatus = confirm.nextStatus;
    const needsDisposition = hasInProgressExam && nextStatus !== "active";
    const chosen = needsDisposition ? disposition : null;
    if (
      !canSubmitAccountStatusChange({
        nextStatus,
        hasInProgressExam,
        disposition: chosen,
        reason,
      })
    ) {
      toast.error(
        chosen === "invalidate"
          ? "A reason is required to void the exam."
          : "Choose what should happen to the open exam."
      );
      return;
    }
    const label = confirm.label;
    setConfirm(null);
    startTransition(async () => {
      const { error } = await setAccountStatus(
        studentId,
        nextStatus,
        chosen ?? undefined,
        chosen === "invalidate" ? reason : undefined
      );
      if (error) toast.error(accountStatusErrorMessage(error));
      else toast.success(`${label} done`);
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
          {menu.some((m) => m.id === "restore_lms") && (
            <DropdownMenuItem
              onClick={() =>
                setConfirm({
                  kind: "account",
                  label: "Restore LMS access",
                  description: "This student will be able to sign in and use the LMS again.",
                  nextStatus: "active",
                })
              }
            >
              Restore LMS access
            </DropdownMenuItem>
          )}
          {BLOCKING_ACCOUNT_ACTIONS.filter((a) =>
            menu.some((m) => m.id === a.menuId)
          ).map((a) => (
            <DropdownMenuItem
              key={a.menuId}
              variant={a.status === "revoked" ? "destructive" : "default"}
              onClick={() =>
                setConfirm({
                  kind: "account",
                  label: a.label,
                  description: a.description,
                  nextStatus: a.status,
                })
              }
            >
              {a.label}
            </DropdownMenuItem>
          ))}
          {menu.some((m) => m.id === "promote_class") && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() =>
                  setConfirm({
                    kind: "simple",
                    label: "Promote to next year",
                    description:
                      "Move this student to the next MBBS year. Their current class is marked as previous (expired). This does not change LMS account access.",
                    run: () => promoteStudent(studentId),
                  })
                }
              >
                Promote to next year
              </DropdownMenuItem>
            </>
          )}
          {menu.some((m) => m.id === "resource_access") && (
            <DropdownMenuItem onClick={() => void openAccess()}>
              Resource access…
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={accessOpen} onOpenChange={setAccessOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Resource access</DialogTitle>
            <DialogDescription>
              Grants unlock a resource for this student. Restrictions always win.
              A blocked account still cannot use LMS resources.
            </DialogDescription>
          </DialogHeader>
          {!access ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="grid gap-5">
              <section className="grid gap-3">
                <h3 className="text-sm font-medium">Practice subjects</h3>
                {access.subjects.map((s) => {
                  const granted = access.grants.some(
                    (g) =>
                      g.grant_type === "practice_subject" && g.subject_id === s.id
                  );
                  const restricted = access.restrictions.some(
                    (r) =>
                      r.resource_kind === "practice_subject" &&
                      r.subject_id === s.id
                  );
                  return (
                    <div
                      key={s.id}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <span>{s.name}</span>
                      <span className="flex items-center gap-3">
                        <label className="flex items-center gap-1 text-xs">
                          Grant
                          <Switch
                            checked={granted}
                            onCheckedChange={(c) => void togglePractice(s.id, c)}
                          />
                        </label>
                        <label className="flex items-center gap-1 text-xs">
                          Restrict
                          <Switch
                            checked={restricted}
                            onCheckedChange={(c) =>
                              void toggleRestrict("practice_subject", s.id, c)
                            }
                          />
                        </label>
                      </span>
                    </div>
                  );
                })}
                {access.subjects.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No subjects in this student&apos;s year yet.
                  </p>
                )}
              </section>
              <section className="grid gap-3">
                <h3 className="text-sm font-medium">Tests</h3>
                {access.tests.map((t) => {
                  const granted = access.grants.some(
                    (g) => g.grant_type === "test" && g.test_id === t.id
                  );
                  const restricted = access.restrictions.some(
                    (r) => r.resource_kind === "test" && r.test_id === t.id
                  );
                  return (
                    <div
                      key={t.id}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <span>{t.title}</span>
                      <span className="flex items-center gap-3">
                        <label className="flex items-center gap-1 text-xs">
                          Grant
                          <Switch
                            checked={granted}
                            onCheckedChange={(c) =>
                              void toggleGrant("test", t.id, c)
                            }
                          />
                        </label>
                        <label className="flex items-center gap-1 text-xs">
                          Restrict
                          <Switch
                            checked={restricted}
                            onCheckedChange={(c) =>
                              void toggleRestrict("test", t.id, c)
                            }
                          />
                        </label>
                      </span>
                    </div>
                  );
                })}
                {access.tests.length === 0 && (
                  <p className="text-sm text-muted-foreground">No tests in this year.</p>
                )}
              </section>
              <section className="grid gap-3">
                <h3 className="text-sm font-medium">Study materials</h3>
                {access.folders.map((f) => {
                  const granted = access.grants.some(
                    (g) =>
                      g.grant_type === "materials_folder" && g.folder_id === f.id
                  );
                  const restricted = access.restrictions.some(
                    (r) =>
                      r.resource_kind === "materials_folder" &&
                      r.folder_id === f.id
                  );
                  return (
                    <div
                      key={f.id}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <span>{f.name}</span>
                      <span className="flex items-center gap-3">
                        <label className="flex items-center gap-1 text-xs">
                          Grant
                          <Switch
                            checked={granted}
                            onCheckedChange={(c) =>
                              void toggleGrant("materials_folder", f.id, c)
                            }
                          />
                        </label>
                        <label className="flex items-center gap-1 text-xs">
                          Restrict
                          <Switch
                            checked={restricted}
                            onCheckedChange={(c) =>
                              void toggleRestrict("materials_folder", f.id, c)
                            }
                          />
                        </label>
                      </span>
                    </div>
                  );
                })}
                {access.folders.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No material folders in this year.
                  </p>
                )}
              </section>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirm !== null}
        onOpenChange={(o) => {
          if (!o) {
            setConfirm(null);
            setReason("");
            setDisposition("leave_in_progress");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirm?.label}</DialogTitle>
            <DialogDescription>{confirm?.description}</DialogDescription>
          </DialogHeader>
          {confirm?.kind === "account" &&
            hasInProgressExam &&
            confirm.nextStatus !== "active" && (
              <fieldset className="grid gap-3 text-sm">
                <legend className="font-medium">Open exam</legend>
                <p className="text-muted-foreground">
                  This student has an exam in progress. Choose what happens to it.
                </p>
                {EXAM_DISPOSITIONS.map((d) => (
                  <label key={d.id} className="flex gap-2 rounded-md border p-2">
                    <input
                      type="radio"
                      name="exam-disposition"
                      value={d.id}
                      checked={disposition === d.id}
                      onChange={() => setDisposition(d.id)}
                      className="mt-1"
                    />
                    <span>
                      <span className="font-medium">{d.label}</span>
                      <span className="mt-0.5 block text-muted-foreground">
                        {d.description}
                      </span>
                    </span>
                  </label>
                ))}
                {disposition === "invalidate" && (
                  <Textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Reason for voiding the exam"
                    required
                  />
                )}
              </fieldset>
            )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                confirm?.kind === "simple" ? executeSimple() : executeAccount()
              }
            >
              {confirm?.label}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
