import { execFileSync } from "node:child_process";
import { test, expect, type Page } from "@playwright/test";
import {
  deleteStudent,
  expireSubscription,
  provisionEnrolledStudent,
  renewSubscription,
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
} from "./fixtures";
import { loadE2EEnv, STAGING_APP_ORIGIN } from "./load-e2e-env";

/**
 * Staging browser lifecycle for Subscription + Payment UI.
 * Uses Auth Admin–provisioned students + Main Admin credentials from
 * `.env.e2e.staging`. Cleans up fixture rows via SSH (medverse_staging only).
 */

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

function stagingSsh(): string {
  return process.env.E2E_STAGING_SSH || loadE2EEnv().stagingSsh || "medverse-vps";
}

function stagingSql(sql: string): string {
  const ssh = stagingSsh();
  try {
    return execFileSync(
      "ssh",
      [
        "-o",
        "BatchMode=yes",
        ssh,
        `sudo -n -u postgres psql -d medverse_staging -v ON_ERROR_STOP=1 -Atqc ${JSON.stringify(sql)}`,
      ],
      { encoding: "utf8" }
    ).trim();
  } catch (err) {
    throw new Error(`stagingSql failed via ${ssh}: ${err}`);
  }
}

function stagingSqlExec(sql: string): void {
  const ssh = stagingSsh();
  const res = execFileSync(
    "ssh",
    [
      "-o",
      "BatchMode=yes",
      ssh,
      `sudo -n -u postgres psql -d medverse_staging -v ON_ERROR_STOP=1 -c ${JSON.stringify(sql)}`,
    ],
    { encoding: "utf8" }
  );
  if (/ERROR:/i.test(res)) {
    throw new Error(`stagingSqlExec error: ${res}`);
  }
}

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  expect(page.url().startsWith(STAGING_APP_ORIGIN)).toBeTruthy();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/(dashboard|admin)/, { timeout: 30000 });
}

async function signOut(page: Page) {
  const btn = page.getByRole("button", { name: "Sign out" });
  if (await btn.count()) {
    await btn.click();
    await page.waitForURL(/\/login/, { timeout: 15000 });
  } else {
    await page.goto("/login");
  }
}

async function confirmDialog(page: Page, buttonName: string | RegExp) {
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 10000 });
  await dialog.getByRole("button", { name: buttonName }).click();
}

async function expectToast(page: Page, pattern: RegExp) {
  await expect(page.getByText(pattern).first()).toBeVisible({ timeout: 25000 });
}

async function expectPaidLocked(page: Page, path: string) {
  await page.goto(path);
  // Badge text also matches its wrapper — assert the intended main badge.
  await expect(
    page.locator("main").getByText("subscription required", { exact: true }).first()
  ).toBeVisible({
    timeout: 20000,
  });
}

async function expectPaidUnlocked(page: Page, path: string, heading: RegExp) {
  await page.goto(path);
  await expect(
    page.locator("main").getByText("subscription required", { exact: true })
  ).toHaveCount(0);
  await expect(page.getByRole("heading", { name: heading })).toBeVisible({
    timeout: 20000,
  });
}

async function selectPlanByName(page: Page, namePart: string) {
  const planSelect = page.locator("#purchase-plan").first();
  await expect(planSelect).toBeVisible();
  const value = await planSelect.locator("option").evaluateAll((opts, part) => {
    const match = opts.find((o) =>
      (o.textContent || "").toLowerCase().includes(part.toLowerCase())
    );
    return match ? (match as HTMLOptionElement).value : null;
  }, namePart);
  expect(value, `plan containing "${namePart}"`).toBeTruthy();
  await planSelect.selectOption(value!);
}

function ensureYearPlans() {
  for (const [yearNumber, name, price] of [
    [1, "E2E UI Y1 Paid", 5000],
    [2, "E2E UI Y2 Paid", 6000],
  ] as const) {
    const exists = stagingSql(
      `select count(*)::text from public.subscription_plans where name='${name}' and is_active`
    );
    if (exists === "0") {
      stagingSqlExec(
        `insert into public.subscription_plans ` +
          `(name, description, duration_days, is_complimentary, is_active, sort_order, year_id, price) ` +
          `select '${name}', 'e2e fixture', 365, false, true, 80, id, ${price} ` +
          `from public.years where year_number=${yearNumber} limit 1`
      );
    }
  }
}

function cleanupStudentArtifacts(studentId: string) {
  // RPC-only tables: disable user triggers for staging fixture teardown only.
  stagingSqlExec(
    `BEGIN; ` +
      `SET LOCAL session_replication_role = replica; ` +
      `delete from public.student_notifications where student_id='${studentId}'::uuid; ` +
      `delete from public.year_change_requests where student_id='${studentId}'::uuid; ` +
      `delete from public.subscription_applications where student_id='${studentId}'::uuid; ` +
      `delete from public.subscriptions where student_id='${studentId}'::uuid; ` +
      `COMMIT;`
  );
}

function cleanupLimitedAdmin(adminId: string) {
  stagingSqlExec(
    `BEGIN; ` +
      `SET LOCAL session_replication_role = replica; ` +
      `delete from public.admin_year_assignments where admin_id='${adminId}'::uuid; ` +
      `delete from public.admin_permissions where admin_id='${adminId}'::uuid; ` +
      `COMMIT;`
  );
}

test.describe("Staging subscription UI lifecycle", () => {
  test("apply → reject → reapply → approve → entitlements → class switch → expiry → restore", async ({
    page,
  }) => {
    const e2e = loadE2EEnv();
    test.skip(e2e.target !== "staging", "E2E_TARGET=staging required");
    test.skip(!e2e.adminEmail || !e2e.adminPassword, "admin credentials required");
    test.skip(!e2e.stagingSsh && !process.env.E2E_STAGING_SSH, "E2E_STAGING_SSH required");

    ensureYearPlans();
    const student = await provisionEnrolledStudent();
    let subscriptionId: string | null = null;

    const y1Id = stagingSql(
      `select id::text from public.years where year_number=1 limit 1`
    );
    const y2Id = stagingSql(
      `select id::text from public.years where year_number=2 limit 1`
    );

    try {
      // ------------------------------------------------------------------
      // STUDENT: plans + invalid handling + apply
      // ------------------------------------------------------------------
      await login(page, student.email, student.password);
      await page.goto("/subscription");
      await expect(
        page.getByRole("heading", { name: "My Subscription" })
      ).toBeVisible({ timeout: 20000 });
      await expect(page.getByText("Available plans").first()).toBeVisible();
      await expect(page.getByText("Get Subscription").first()).toBeVisible();

      await page.getByLabel(/Amount paid/i).first().fill("0");
      await page.getByRole("button", { name: "Submit for review" }).first().click();
      await expect(
        page.getByText(/valid payment amount greater than zero/i).first()
      ).toBeVisible({ timeout: 10000 });

      await page.getByLabel(/Amount paid/i).first().fill("5000");
      await page.getByRole("button", { name: "Submit for review" }).first().click();
      await expect(
        page.getByText(/Confirm the purchase class before submitting/i).first()
      ).toBeVisible({ timeout: 10000 });

      await page
        .getByRole("checkbox", {
          name: /I confirm this subscription purchase is for/i,
        })
        .first()
        .check();
      await page.getByRole("button", { name: "Submit for review" }).first().click();
      await expect(
        page.getByText(/Upload a payment screenshot before submitting/i).first()
      ).toBeVisible({ timeout: 10000 });

      await selectPlanByName(page, "E2E UI Y1 Paid");

      await page.locator("#screenshot").first().setInputFiles({
        name: "payment-proof.png",
        mimeType: "image/png",
        buffer: TINY_PNG,
      });
      await page.getByRole("button", { name: "Submit for review" }).first().click();
      await expect(page.getByText(/pending/i).first()).toBeVisible({
        timeout: 60000,
      });
      await expect(page.getByText(/5000/).first()).toBeVisible();

      // One paid surface is enough to prove pending does not unlock.
      await expectPaidLocked(page, "/mcq-bank");

      await signOut(page);

      // ------------------------------------------------------------------
      // ADMIN: year filter + reject first application
      // ------------------------------------------------------------------
      await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
      // Year scope: Y2 filter must hide the Y1 applicant, then Y1 shows them.
      await page.goto(
        `/admin/subscriptions/applications?status=pending&year=${encodeURIComponent(y2Id)}`
      );
      await expect(
        page.getByRole("heading", { name: /Subscription applications/i })
      ).toBeVisible({ timeout: 20000 });
      await expect(page.getByText(student.email)).toHaveCount(0, {
        timeout: 15000,
      });

      await page.goto(
        `/admin/subscriptions/applications?status=pending&year=${encodeURIComponent(y1Id)}`
      );
      await expect(page.getByText(student.email).first()).toBeVisible({
        timeout: 20000,
      });

      const rejectRow = page.locator("tr", { hasText: student.email }).first();
      await rejectRow.getByRole("button", { name: "Reject" }).click();
      await confirmDialog(page, "Confirm");
      await expectToast(page, /Application rejected/i);

      await signOut(page);

      // ------------------------------------------------------------------
      // STUDENT: rejected status + reapply
      // ------------------------------------------------------------------
      await login(page, student.email, student.password);
      await page.goto("/subscription");
      await expect(
        page.getByText(/Previous application rejected|Application rejected/i).first()
      ).toBeVisible({ timeout: 20000 });

      await selectPlanByName(page, "E2E UI Y1 Paid");
      await page.getByLabel(/Amount paid/i).fill("5200");
      await page
        .getByRole("checkbox", {
          name: /I confirm this subscription purchase is for/i,
        })
        .check();
      await page.locator("#screenshot").setInputFiles({
        name: "payment-proof-2.png",
        mimeType: "image/png",
        buffer: TINY_PNG,
      });
      await page.getByRole("button", { name: "Submit for review" }).click();
      await expect(page.getByText(/pending/i).first()).toBeVisible({
        timeout: 60000,
      });

      await signOut(page);

      // ------------------------------------------------------------------
      // ADMIN: approve
      // ------------------------------------------------------------------
      await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
      await page.goto(
        `/admin/subscriptions/applications?status=pending&year=${encodeURIComponent(y1Id)}`
      );
      await expect(page.getByText(student.email).first()).toBeVisible({
        timeout: 20000,
      });
      const approveRow = page.locator("tr", { hasText: student.email }).first();
      await approveRow.getByRole("button", { name: "Approve" }).click();
      await confirmDialog(page, "Confirm");
      // Surface mapped admin errors if approve fails (plan/year coherence, etc.).
      const outcome = page
        .getByText(
          /Application approved|selected plan belongs to a different class|permission_denied|Something went wrong|do not have permission/i
        )
        .first();
      await expect(outcome).toBeVisible({ timeout: 25000 });
      await expect(page.getByText(/Application approved/i)).toBeVisible();

      const subBefore = stagingSql(
        `select id::text || '|' || starts_at::text || '|' || ends_at::text || '|' || plan_id::text ` +
          `from public.subscriptions ` +
          `where student_id='${student.studentId}'::uuid and status='active' ` +
          `order by created_at desc limit 1`
      );
      const [subscriptionIdRaw, startsBefore, endsBefore, planBefore] =
        subBefore.split("|");
      subscriptionId = subscriptionIdRaw;
      expect(subscriptionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );

      await signOut(page);

      // ------------------------------------------------------------------
      // STUDENT: active + entitlements (MCQ / Notes / One Liner / Syllabus)
      // ------------------------------------------------------------------
      await login(page, student.email, student.password);
      await page.goto("/subscription");
      await expect(page.getByText("active", { exact: true }).first()).toBeVisible({
        timeout: 20000,
      });
      await expect(page.getByText(/Remaining|Ends/i).first()).toBeVisible();

      await expectPaidUnlocked(page, "/mcq-bank", /MCQ Bank/i);
      await expectPaidUnlocked(page, "/notes", /Notes/i);
      await expectPaidUnlocked(page, "/one-liner", /One[- ]?Liner/i);

      await page.goto("/academic");
      await expect(page.getByRole("heading", { name: "Academic" })).toBeVisible({
        timeout: 15000,
      });
      const blockLink = page
        .locator("main")
        .getByRole("link", {
          name: /^(Block \d+|Medicine|Surgery|Gynecology|Pediatrics)$/,
        })
        .first();
      if (await blockLink.count()) {
        await blockLink.click();
        await expect(
          page.getByRole("link", { name: /^Syllabus$/i }).first()
        ).toBeVisible({ timeout: 15000 });
      }

      // ------------------------------------------------------------------
      // CLASS SWITCH UI
      // ------------------------------------------------------------------
      await page.goto("/profile");
      await expect(
        page.getByText(/Class locked — active subscription/i)
      ).toBeVisible({ timeout: 20000 });

      await page.locator("#to-year").selectOption(y2Id);
      await page.getByRole("button", { name: "Request year change" }).click();
      await expect(page.getByText(/Year-change request submitted/i)).toBeVisible({
        timeout: 20000,
      });
      await expect(page.getByText("pending", { exact: true }).first()).toBeVisible({
        timeout: 20000,
      });

      await signOut(page);
      await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
      await page.goto("/admin/year-changes?status=pending");
      await expect(page.getByText(student.email).first()).toBeVisible({
        timeout: 20000,
      });
      const ycRow = page.locator("tr", { hasText: student.email }).first();
      await ycRow.getByRole("button", { name: "Approve" }).click();
      await confirmDialog(page, "Approve");
      await expectToast(page, /Year change approved/i);

      const afterRow = stagingSql(
        `select s.year_id::text || '|' || s.starts_at::text || '|' || s.ends_at::text || '|' || ` +
          `s.plan_id::text || '|' || e.year_id::text || '|' || p.year_id::text || '|' || ` +
          `(select count(*)::text from public.enrollments ` +
          ` where student_id='${student.studentId}'::uuid and status='active' and year_id='${y1Id}'::uuid) ` +
          `from public.subscriptions s ` +
          `join public.enrollments e on e.student_id=s.student_id and e.status='active' ` +
          `join public.subscription_plans p on p.id=s.plan_id ` +
          `where s.id='${subscriptionId}'::uuid limit 1`
      );
      const [
        yearAfter,
        startsAfter,
        endsAfter,
        planAfter,
        enrollYear,
        destPlanYear,
        oldEnrollment,
      ] = afterRow.split("|");

      expect(yearAfter).toBe(y2Id);
      expect(enrollYear).toBe(y2Id);
      expect(startsAfter).toBe(startsBefore);
      expect(endsAfter).toBe(endsBefore);
      expect(planAfter).not.toBe(planBefore);
      expect(destPlanYear).toBe(y2Id);
      expect(oldEnrollment).toBe("0");

      await signOut(page);
      await login(page, student.email, student.password);
      await page.goto("/profile");
      await expect(
        page.getByText(/Your subscription is for/i).first()
      ).toBeVisible({
        timeout: 20000,
      });
      await expect(page.locator("#locked-class").first()).toContainText(
        /2nd|Year 2|2 /i
      );

      await expectPaidUnlocked(page, "/mcq-bank", /MCQ Bank/i);
      await expectPaidUnlocked(page, "/notes", /Notes/i);

      // ------------------------------------------------------------------
      // EXPIRY + reauthorization (student session already active)
      // ------------------------------------------------------------------
      await expireSubscription(subscriptionId!);
      await expectPaidLocked(page, "/mcq-bank");

      await renewSubscription(subscriptionId!);
      await expectPaidUnlocked(page, "/mcq-bank", /MCQ Bank/i);
      await expectPaidUnlocked(page, "/notes", /Notes/i);
      await page.goto("/dashboard");
      await expect(page).toHaveURL(/\/dashboard/);
    } finally {
      cleanupStudentArtifacts(student.studentId);
      await deleteStudent(student.studentId);
    }
  });

  test("limited-admin year scope: Y2-only admin cannot see Y1 applications", async ({
    page,
  }) => {
    const e2e = loadE2EEnv();
    test.skip(e2e.target !== "staging", "E2E_TARGET=staging required");
    test.skip(!e2e.stagingSsh && !process.env.E2E_STAGING_SSH, "E2E_STAGING_SSH required");

    ensureYearPlans();
    const student = await provisionEnrolledStudent();
    const suffix = Math.random().toString(36).slice(2, 8);
    const limEmail = `e2e-lim-sub-${suffix}@test.invalid`;
    const limPassword = `LimSub${suffix}Aa1!`;
    let limId: string | null = null;

    try {
      const y1 = stagingSql(
        `select id::text from public.years where year_number=1 limit 1`
      );
      const y2 = stagingSql(
        `select id::text from public.years where year_number=2 limit 1`
      );

      // Seed pending application via legitimate student UI (RPC-only table).
      await login(page, student.email, student.password);
      await page.goto("/subscription");
      await selectPlanByName(page, "E2E UI Y1 Paid");
      await page.getByLabel(/Amount paid/i).fill("1111");
      await page
        .getByRole("checkbox", {
          name: /I confirm this subscription purchase is for/i,
        })
        .check();
      await page.locator("#screenshot").setInputFiles({
        name: "lim-scope.png",
        mimeType: "image/png",
        buffer: TINY_PNG,
      });
      await page.getByRole("button", { name: "Submit for review" }).click();
      await expect(page.getByText(/pending/i).first()).toBeVisible({
        timeout: 60000,
      });
      await signOut(page);

      const createRes = await fetch(
        `${e2e.authUrl.replace(/\/$/, "")}/auth/v1/admin/users`,
        {
          method: "POST",
          headers: {
            apikey: e2e.serviceRoleKey,
            Authorization: `Bearer ${e2e.serviceRoleKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email: limEmail,
            password: limPassword,
            email_confirm: true,
            user_metadata: { full_name: `E2E Lim Sub ${suffix}` },
          }),
        }
      ).then((r) => r.json());
      limId = createRes.id as string;
      expect(limId).toBeTruthy();

      // Bridge Cloud Auth user → VPS profiles before promoting to limited admin.
      const limLogin = await fetch(
        `${e2e.authUrl.replace(/\/$/, "")}/auth/v1/token?grant_type=password`,
        {
          method: "POST",
          headers: {
            apikey: e2e.anonKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ email: limEmail, password: limPassword }),
        }
      ).then((r) => r.json());
      expect(limLogin.access_token).toBeTruthy();
      await fetch(`${e2e.restUrl.replace(/\/$/, "")}/rest/v1/rpc/ensure_profile`, {
        method: "POST",
        headers: {
          apikey: e2e.anonKey,
          Authorization: `Bearer ${limLogin.access_token}`,
          "Content-Type": "application/json",
        },
        body: "{}",
      });

      stagingSqlExec(
        `update public.profiles set role='admin', is_main_admin=false, account_status='active' ` +
          `where id='${limId}'::uuid; ` +
          `insert into public.admin_permissions (admin_id, permission_code) values ` +
          `('${limId}'::uuid,'manage_subscriptions'),` +
          `('${limId}'::uuid,'review_subscription_applications') ` +
          `on conflict do nothing;`
      );

      // Year assignments are RPC-only — use Main Admin JWT.
      const adminLogin = await fetch(
        `${e2e.authUrl.replace(/\/$/, "")}/auth/v1/token?grant_type=password`,
        {
          method: "POST",
          headers: {
            apikey: e2e.anonKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email: e2e.adminEmail,
            password: e2e.adminPassword,
          }),
        }
      ).then((r) => r.json());
      expect(adminLogin.access_token).toBeTruthy();
      const assignRes = await fetch(
        `${e2e.restUrl.replace(/\/$/, "")}/rest/v1/rpc/set_admin_year_assignments`,
        {
          method: "POST",
          headers: {
            apikey: e2e.anonKey,
            Authorization: `Bearer ${adminLogin.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            p_admin_id: limId,
            p_year_ids: [y2],
          }),
        }
      );
      expect(assignRes.ok, await assignRes.text()).toBeTruthy();

      await login(page, limEmail, limPassword);
      await page.goto(
        `/admin/subscriptions/applications?status=pending&year=${encodeURIComponent(y1)}`
      );
      // Year scope / RLS: Y1 application must not appear for Y2-only admin
      await expect(page.getByText(student.email)).toHaveCount(0, {
        timeout: 20000,
      });

      await page.goto("/admin/subscriptions/applications?status=pending");
      const y2Card = page.getByRole("button", { name: /2nd Year MBBS|Year 2/i }).first();
      if (await y2Card.count()) {
        await y2Card.click();
      }
      await expect(page.getByText(student.email)).toHaveCount(0);
    } finally {
      cleanupStudentArtifacts(student.studentId);
      await deleteStudent(student.studentId);
      if (limId) {
        cleanupLimitedAdmin(limId);
        await deleteStudent(limId);
      }
    }
  });
});
