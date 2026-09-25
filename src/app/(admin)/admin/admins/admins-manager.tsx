"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  createAdminAccount,
  demoteAdmin,
  promoteStudentToAdmin,
  setAdminAccountStatus,
  setAdminPermissions,
  setAdminYearAssignmentsAction,
} from "@/lib/actions/admins";
import {
  ADMIN_PERMISSION_CATALOG,
  ADMIN_PRESETS,
  adminRbacErrorMessage,
  canDemoteAdmin,
  canDisableAdmin,
  codesForPreset,
  isBlockedAdminStatus,
  type AdminAccountRow,
  type AdminPermissionCode,
  type AdminPresetId,
} from "@/lib/admin/admin-rbac-ui";
import { accountStatusLabel } from "@/lib/admin/student-account-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function PermissionPicker({
  codes,
  onChange,
  disabled,
}: {
  codes: AdminPermissionCode[];
  onChange: (next: AdminPermissionCode[]) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {ADMIN_PERMISSION_CATALOG.map((p) => (
        <label key={p.code} className="flex items-start gap-2 text-sm">
          <Checkbox
            checked={codes.includes(p.code)}
            disabled={disabled}
            onCheckedChange={(v) => {
              if (v === true) onChange([...codes, p.code]);
              else onChange(codes.filter((c) => c !== p.code));
            }}
          />
          <span>
            <span className="font-medium">{p.label}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {p.code}
            </span>
          </span>
        </label>
      ))}
    </div>
  );
}

function CreateForm({
  title,
  mode,
  pending,
  canGrantMainAdmin,
  onSubmit,
}: {
  title: string;
  mode: "create" | "promote";
  pending: boolean;
  canGrantMainAdmin: boolean;
  onSubmit: (input: {
    email: string;
    fullName: string;
    password: string;
    codes: AdminPermissionCode[];
    makeMainAdmin: boolean;
  }) => void;
}) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [preset, setPreset] = useState<AdminPresetId>("academic");
  const [codes, setCodes] = useState<AdminPermissionCode[]>(
    codesForPreset("academic")
  );
  const [makeMain, setMakeMain] = useState(false);

  return (
    <form
      className="grid min-w-0 gap-3 rounded-lg border p-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          email,
          fullName,
          password,
          codes,
          makeMainAdmin: makeMain,
        });
      }}
    >
      <h2 className="text-base font-semibold">{title}</h2>
      {mode === "create" ? (
        <p className="text-xs text-muted-foreground">
          If this email already has an LMS account (including a demoted admin),
          Create reuses that same Auth/profile identity and promotes them —
          it does not create a duplicate login.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Prefer this when you know the person already has a student account.
        </p>
      )}
      {mode === "create" && (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="grid min-w-0 gap-1">
            <Label htmlFor={`${mode}-name`}>Full name</Label>
            <Input
              id={`${mode}-name`}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
            />
          </div>
          <div className="grid min-w-0 gap-1">
            <Label htmlFor={`${mode}-password`}>Temporary password</Label>
            <Input
              id={`${mode}-password`}
              type="password"
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
        </div>
      )}
      <div className="grid min-w-0 gap-1">
        <Label htmlFor={`${mode}-email`}>Email</Label>
        <Input
          id={`${mode}-email`}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>
      <div className="grid gap-2">
        <p className="text-sm font-medium">Authority</p>
        <div className="flex flex-wrap gap-2">
          {canGrantMainAdmin && (
            <Button
              type="button"
              size="sm"
              variant={makeMain ? "default" : "outline"}
              onClick={() => setMakeMain(true)}
            >
              Full / Main Admin
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant={!makeMain ? "default" : "outline"}
            onClick={() => {
              setMakeMain(false);
              setPreset("custom");
            }}
          >
            Custom Permissions
          </Button>
        </div>
        {makeMain ? (
          <p className="rounded-md border border-border/80 bg-muted/40 px-3 py-2 text-sm">
            Full administrative access — every current and future admin job,
            all classes, and admin management.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {ADMIN_PRESETS.map((p) => (
                <Button
                  key={p.id}
                  type="button"
                  size="sm"
                  variant={preset === p.id ? "secondary" : "outline"}
                  onClick={() => {
                    setPreset(p.id);
                    if (p.id !== "custom") setCodes(codesForPreset(p.id));
                  }}
                >
                  {p.label}
                </Button>
              ))}
            </div>
            <PermissionPicker codes={codes} onChange={setCodes} />
          </>
        )}
      </div>
      <Button type="submit" disabled={pending} className="w-fit">
        {mode === "create" ? "Create admin" : "Promote to admin"}
      </Button>
    </form>
  );
}

export function AdminsManager({
  admins,
  canManage,
  canGrantMainAdmin,
  years,
  yearIdsByAdmin,
}: {
  admins: AdminAccountRow[];
  canManage: boolean;
  canGrantMainAdmin: boolean;
  years: { id: string; year_number: number; name: string }[];
  yearIdsByAdmin: Record<string, string[]>;
}) {
  const [pending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = useMemo(
    () => admins.find((a) => a.id === editingId) ?? null,
    [admins, editingId]
  );
  const [editCodes, setEditCodes] = useState<AdminPermissionCode[]>([]);
  const [editMain, setEditMain] = useState(false);
  const [editYearIds, setEditYearIds] = useState<string[]>([]);

  function run(
    fn: () => Promise<{ error?: string | null; id?: string }>,
    ok: string
  ) {
    startTransition(async () => {
      const res = await fn();
      if (res.error) toast.error(adminRbacErrorMessage(res.error));
      else if (ok) toast.success(ok);
    });
  }

  if (!canManage) {
    return (
      <p className="text-sm text-muted-foreground">
        Managing admins requires <code>manage_admins</code>.
      </p>
    );
  }

  return (
    <div className="grid min-w-0 gap-6">
      <div className="grid gap-4 lg:grid-cols-2">
        <CreateForm
          title="Create a new admin account"
          mode="create"
          pending={pending}
          canGrantMainAdmin={canGrantMainAdmin}
          onSubmit={(input) =>
            run(async () => {
              const res = await createAdminAccount(input);
              if ("error" in res && res.error) return { error: res.error };
              if ("reusedExisting" in res && res.reusedExisting) {
                toast.success(
                  "That email already had an account — promoted back to admin (same identity)."
                );
                return { id: res.id };
              }
              toast.success(
                "Admin account created. Share the password out of band."
              );
              return { id: "id" in res ? res.id : undefined };
            }, "")
          }
        />
        <CreateForm
          title="Promote an existing student"
          mode="promote"
          pending={pending}
          canGrantMainAdmin={canGrantMainAdmin}
          onSubmit={(input) =>
            run(
              () =>
                promoteStudentToAdmin({
                  email: input.email,
                  codes: input.codes,
                  makeMainAdmin: input.makeMainAdmin,
                }),
              "Student promoted to admin (same Auth/profile identity)."
            )
          }
        />
      </div>

      <div className="min-w-0 overflow-x-auto rounded-xl border border-border/80">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Admin</TableHead>
            <TableHead>Access</TableHead>
            <TableHead>Jobs</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {admins.map((admin) => (
            <TableRow key={admin.id}>
              <TableCell>
                <div className="font-medium">{admin.full_name || "—"}</div>
                <div className="text-xs text-muted-foreground">
                  {admin.email}
                </div>
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {admin.is_main_admin && (
                    <Badge variant="default">Main Admin</Badge>
                  )}
                  <Badge
                    variant={
                      isBlockedAdminStatus(admin.account_status)
                        ? "destructive"
                        : "secondary"
                    }
                  >
                    {accountStatusLabel(admin.account_status)}
                  </Badge>
                </div>
              </TableCell>
              <TableCell className="max-w-xs text-xs text-muted-foreground">
                {admin.is_main_admin
                  ? "All permissions"
                  : admin.permission_codes.join(", ") || "None yet"}
              </TableCell>
              <TableCell className="flex flex-wrap justify-end gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => {
                    setEditingId(admin.id);
                    setEditMain(admin.is_main_admin);
                    setEditCodes(
                      admin.permission_codes.filter((c) =>
                        ADMIN_PERMISSION_CATALOG.some((p) => p.code === c)
                      ) as AdminPermissionCode[]
                    );
                    setEditYearIds(yearIdsByAdmin[admin.id] ?? []);
                  }}
                >
                  Jobs
                </Button>
                {isBlockedAdminStatus(admin.account_status) ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      run(
                        () => setAdminAccountStatus(admin.id, "active"),
                        "Admin LMS access restored."
                      )
                    }
                  >
                    Restore
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending || !canDisableAdmin(admins, admin.id)}
                    onClick={() =>
                      run(
                        () => setAdminAccountStatus(admin.id, "suspended"),
                        "Admin LMS access disabled."
                      )
                    }
                  >
                    Disable
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending || !canDemoteAdmin(admins, admin.id)}
                  onClick={() =>
                    run(() => demoteAdmin(admin.id), "Admin rights removed.")
                  }
                >
                  Remove
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      </div>

      {editing && (
        <form
          className="grid min-w-0 gap-3 rounded-lg border p-4"
          onSubmit={(e) => {
            e.preventDefault();
            const id = editing.id;
            run(async () => {
              const jobs = await setAdminPermissions(id, editCodes, editMain);
              if (jobs.error) return jobs;
              if (!editMain) {
                const yearsRes = await setAdminYearAssignmentsAction(
                  id,
                  editYearIds
                );
                if (yearsRes.error) return yearsRes;
              }
              return {};
            }, "Admin jobs and class scope updated.");
          }}
        >
          <h2 className="text-base font-semibold">
            Jobs for {editing.full_name || editing.email}
          </h2>
          {canGrantMainAdmin ? (
            <div className="grid gap-2">
              <p className="text-sm font-medium">Authority</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={editMain ? "default" : "outline"}
                  onClick={() => setEditMain(true)}
                >
                  Full / Main Admin
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={!editMain ? "default" : "outline"}
                  onClick={() => setEditMain(false)}
                >
                  Custom Permissions
                </Button>
              </div>
              {editMain && (
                <p className="rounded-md border border-border/80 bg-muted/40 px-3 py-2 text-sm">
                  Full administrative access
                </p>
              )}
            </div>
          ) : (
            editing.is_main_admin && (
              <p className="text-sm text-muted-foreground">
                This account is a Main Admin. Only a Main Admin can change Full
                Access.
              </p>
            )
          )}
          {!editMain && (
            <>
              <PermissionPicker codes={editCodes} onChange={setEditCodes} />
              <div className="grid gap-2">
                <p className="text-sm font-medium">Assigned classes</p>
                <p className="text-xs text-muted-foreground">
                  Limited admins need both class assignment and the matching
                  job permission. Backend RPCs enforce this.
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {years.map((y) => (
                    <label key={y.id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={editYearIds.includes(y.id)}
                        onCheckedChange={(v) => {
                          if (v === true) {
                            setEditYearIds([...editYearIds, y.id]);
                          } else {
                            setEditYearIds(
                              editYearIds.filter((id) => id !== y.id)
                            );
                          }
                        }}
                      />
                      {y.name}
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending || (!canGrantMainAdmin && editMain && !editing.is_main_admin)}>
              Save jobs
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditingId(null)}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
