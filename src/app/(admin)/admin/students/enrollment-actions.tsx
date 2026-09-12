"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  setEnrollmentStatus,
  promoteStudent,
  getStudentAccess,
  grantPracticeSubject,
  revokeGrant,
} from "@/lib/actions/enrollment";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
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
  enrollmentId: string;
  studentId: string;
  yearId: string;
  status: string;
};

type AccessData = {
  subjects: { id: string; name: string }[];
  grants: { id: string; grant_type: string; subject_id: string | null }[];
};

export function EnrollmentActions({ enrollmentId, studentId, yearId, status }: Props) {
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState<null | {
    label: string;
    description: string;
    run: () => Promise<{ error?: string }>;
  }>(null);
  const [accessOpen, setAccessOpen] = useState(false);
  const [access, setAccess] = useState<AccessData | null>(null);

  async function openAccess() {
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
    setAccess(await getStudentAccess(studentId, yearId));
  }

  function run(label: string, description: string, fn: () => Promise<{ error?: string }>) {
    setConfirm({ label, description, run: fn });
  }

  function execute() {
    const c = confirm;
    if (!c) return;
    setConfirm(null);
    startTransition(async () => {
      const { error } = await c.run();
      if (error) toast.error(error);
      else toast.success(`${c.label} done`);
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
          {status === "pending" && (
            <DropdownMenuItem
              onClick={() =>
                run("Approve", "Activate this student's enrollment?", () =>
                  setEnrollmentStatus(enrollmentId, "active")
                )
              }
            >
              Approve
            </DropdownMenuItem>
          )}
          {status === "active" && (
            <>
              <DropdownMenuItem
                onClick={() =>
                  run(
                    "Promote",
                    "Move this student to the next MBBS year? Their current enrollment is marked expired.",
                    () => promoteStudent(studentId)
                  )
                }
              >
                Promote to next year
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  run("Suspend", "Temporarily suspend this student's access?", () =>
                    setEnrollmentStatus(enrollmentId, "suspended")
                  )
                }
              >
                Suspend
              </DropdownMenuItem>
            </>
          )}
          {status === "suspended" && (
            <DropdownMenuItem
              onClick={() =>
                run("Reactivate", "Restore this student's access?", () =>
                  setEnrollmentStatus(enrollmentId, "active")
                )
              }
            >
              Reactivate
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={openAccess}>
            Practice access…
          </DropdownMenuItem>
          {status !== "revoked" && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() =>
                  run(
                    "Revoke",
                    "Permanently revoke this enrollment? The student loses all access.",
                    () => setEnrollmentStatus(enrollmentId, "revoked")
                  )
                }
              >
                Revoke
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={accessOpen} onOpenChange={setAccessOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Practice access</DialogTitle>
            <DialogDescription>
              Toggle which subjects this student can practice.
            </DialogDescription>
          </DialogHeader>
          {!access ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="grid gap-3">
              {access.subjects.map((s) => {
                const granted = access.grants.some(
                  (g) =>
                    g.grant_type === "practice_subject" && g.subject_id === s.id
                );
                return (
                  <label
                    key={s.id}
                    className="flex items-center justify-between text-sm"
                  >
                    {s.name}
                    <Switch
                      checked={granted}
                      onCheckedChange={(c) => void togglePractice(s.id, c)}
                    />
                  </label>
                );
              })}
              {access.subjects.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No subjects in this student's year yet.
                </p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirm?.label}</DialogTitle>
            <DialogDescription>{confirm?.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button onClick={execute}>{confirm?.label}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
