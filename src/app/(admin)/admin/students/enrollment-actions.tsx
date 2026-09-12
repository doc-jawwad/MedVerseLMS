"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  setEnrollmentStatus,
  promoteStudent,
} from "@/lib/actions/enrollment";
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
  status: string;
};

export function EnrollmentActions({ enrollmentId, studentId, status }: Props) {
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState<null | {
    label: string;
    description: string;
    run: () => Promise<{ error?: string }>;
  }>(null);

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
