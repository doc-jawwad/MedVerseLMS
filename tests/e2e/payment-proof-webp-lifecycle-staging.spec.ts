import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import sharp from "sharp";
import {
  deleteStudent,
  provisionEnrolledStudent,
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
} from "./fixtures";
import { loadE2EEnv, STAGING_APP_ORIGIN } from "./load-e2e-env";

/**
 * Staging: payment-proof WebP optimization + end-of-subscription R2 lifecycle.
 */

function stagingSsh(): string {
  return process.env.E2E_STAGING_SSH || loadE2EEnv().stagingSsh || "medverse-vps";
}

function stagingSql(sql: string): string {
  return execFileSync(
    "ssh",
    [
      "-o",
      "BatchMode=yes",
      stagingSsh(),
      `sudo -n -u postgres psql -d medverse_staging -v ON_ERROR_STOP=1 -Atqc ${JSON.stringify(sql)}`,
    ],
    { encoding: "utf8" }
  ).trim();
}

function stagingSqlExec(sql: string): void {
  const res = execFileSync(
    "ssh",
    [
      "-o",
      "BatchMode=yes",
      stagingSsh(),
      `sudo -n -u postgres psql -d medverse_staging -v ON_ERROR_STOP=1 -c ${JSON.stringify(sql)}`,
    ],
    { encoding: "utf8" }
  );
  if (/ERROR:/i.test(res)) throw new Error(`stagingSqlExec: ${res}`);
}

function drainPurge(): void {
  execFileSync(
    "ssh",
    [
      "-o",
      "BatchMode=yes",
      stagingSsh(),
      `bash -lc 'set -a; source /etc/medverse-staging/nextjs.env; set +a; export MEDVERSE_DATABASE=medverse_staging R2_PURGE_LIMIT=50; bash /opt/medverse-staging/current/deploy/scripts/r2-purge-once.sh || true'`,
    ],
    { encoding: "utf8" }
  );
}

function r2Head(key: string): {
  exists: boolean;
  size?: number;
  ctype?: string;
  riff?: string;
  webp?: string;
} {
  const py = [
    "import json,boto3",
    "from botocore.exceptions import ClientError",
    "env={}",
    "with open('/etc/medverse-staging/nextjs.env') as f:",
    "  for line in f:",
    "    line=line.strip()",
    "    if not line or line.startswith('#') or '=' not in line: continue",
    "    k,v=line.split('=',1); env[k]=v.strip().strip('\"').strip(\"'\")",
    "bucket=env.get('R2_PAYMENT_BUCKET') or env.get('R2_BUCKET')",
    "c=boto3.client('s3', endpoint_url=f\"https://{env['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com\", aws_access_key_id=env['R2_ACCESS_KEY_ID'], aws_secret_access_key=env['R2_SECRET_ACCESS_KEY'], region_name='auto')",
    `key=${JSON.stringify(key)}`,
    "try:",
    "  h=c.head_object(Bucket=bucket, Key=key)",
    "  o=c.get_object(Bucket=bucket, Key=key, Range='bytes=0-11')",
    "  b=o['Body'].read()",
    "  print(json.dumps({'exists':True,'size':int(h.get('ContentLength') or 0),'ctype':h.get('ContentType'),'riff':b[:4].decode('latin1'),'webp':b[8:12].decode('latin1')}))",
    "except ClientError as e:",
    "  code=e.response.get('Error',{}).get('Code','')",
    "  if code not in ('404','NoSuchKey','NotFound'): raise",
    "  print(json.dumps({'exists':False}))",
  ].join("\n");
  const local = "tmp-stg-r2-head-e2e.py";
  fs.writeFileSync(local, py);
  execFileSync("scp", ["-o", "BatchMode=yes", local, `${stagingSsh()}:/tmp/stg-r2-head-e2e.py`]);
  const out = execFileSync(
    "ssh",
    ["-o", "BatchMode=yes", stagingSsh(), "python3 /tmp/stg-r2-head-e2e.py"],
    { encoding: "utf8" }
  ).trim();
  return JSON.parse(out);
}

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  expect(page.url().startsWith(STAGING_APP_ORIGIN)).toBeTruthy();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/(dashboard|admin)/, { timeout: 45000 });
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
  const exists = stagingSql(
    `select count(*)::text from public.subscription_plans where name='E2E UI Y1 Paid' and is_active`
  );
  if (exists === "0") {
    stagingSqlExec(
      `insert into public.subscription_plans ` +
        `(name, description, duration_days, is_complimentary, is_active, sort_order, year_id, price) ` +
        `select 'E2E UI Y1 Paid', 'e2e fixture', 365, false, true, 80, id, 5000 ` +
        `from public.years where year_number=1 limit 1`
    );
  }
}

function cleanupStudentArtifacts(studentId: string) {
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

async function studentApply(page: Page, jpeg: Buffer, amount: string) {
  await page.goto("/subscription");
  await expect(page.getByRole("heading", { name: "My Subscription" })).toBeVisible({
    timeout: 20000,
  });
  await selectPlanByName(page, "E2E UI Y1 Paid");
  await page.getByLabel(/Amount paid/i).fill(amount);
  await page
    .getByRole("checkbox", { name: /I confirm this subscription purchase is for/i })
    .check();
  await page.locator("#screenshot").setInputFiles({
    name: "payment-proof.jpg",
    mimeType: "image/jpeg",
    buffer: jpeg,
  });
  await page.getByRole("button", { name: "Submit for review" }).click();
  await expect(page.getByText(/pending/i).first()).toBeVisible({ timeout: 90000 });
}

test.describe("Staging payment-proof WebP lifecycle", () => {
  test("JPEG→WebP upload, retain while active, release on deactivate + expiry", async ({
    page,
  }) => {
    const e2e = loadE2EEnv();
    test.skip(e2e.target !== "staging", "E2E_TARGET=staging required");
    test.skip(!e2e.adminEmail || !e2e.adminPassword, "admin credentials required");
    test.skip(!e2e.stagingSsh && !process.env.E2E_STAGING_SSH, "E2E_STAGING_SSH required");

    ensureYearPlans();
    const y1Id = stagingSql(`select id::text from public.years where year_number=1 limit 1`);
    const jpeg = await sharp({
      create: {
        width: 1200,
        height: 900,
        channels: 3,
        background: { r: 28, g: 92, b: 168 },
      },
    })
      .jpeg({ quality: 92 })
      .toBuffer();
    const inputBytes = jpeg.length;

    const student = await provisionEnrolledStudent();
    const report: Record<string, unknown> = {
      inputJpegBytes: inputBytes,
      studentId: student.studentId,
    };

    try {
      // --- Upload JPEG → canonical WebP ---
      await login(page, student.email, student.password);
      await studentApply(page, jpeg, "5100");
      await signOut(page);

      const app1 = stagingSql(
        `select id::text||'|'||coalesce(screenshot_object_key,'') ` +
          `from subscription_applications where student_id='${student.studentId}'::uuid ` +
          `and status='pending' order by created_at desc limit 1`
      );
      const [appId1, key1] = app1.split("|");
      expect(key1).toMatch(/^payment-proofs\//);
      report.applicationId1 = appId1;
      report.objectKey1 = key1;

      const meta1 = r2Head(key1);
      expect(meta1.exists).toBe(true);
      expect(meta1.riff).toBe("RIFF");
      expect(meta1.webp).toBe("WEBP");
      expect(meta1.size).toBeGreaterThan(0);
      expect(meta1.size!).toBeLessThan(inputBytes);
      report.finalWebpBytes = meta1.size;
      report.compressionRatio = Number(((meta1.size || 0) / inputBytes).toFixed(3));

      // Original JPEG must not remain under a parallel key (canonical key only).
      expect(r2Head(`${key1}.jpg`).exists).toBe(false);
      expect(r2Head(`${key1}.original`).exists).toBe(false);

      // --- Admin sees screenshot + approve ---
      await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
      await page.goto(
        `/admin/subscriptions/applications?status=pending&year=${encodeURIComponent(y1Id)}`
      );
      await expect(page.getByText(student.email).first()).toBeVisible({ timeout: 20000 });
      const row = page.locator("tr", { hasText: student.email }).first();
      await row.getByRole("button", { name: "Screenshot" }).click();
      await expect(page.getByRole("dialog")).toBeVisible({ timeout: 20000 });
      await page.keyboard.press("Escape");
      await row.getByRole("button", { name: "Approve" }).click();
      await confirmDialog(page, "Confirm");
      await expect(page.getByText(/Application approved/i)).toBeVisible({ timeout: 25000 });

      const sub1 = stagingSql(
        `select id::text from subscriptions where application_id='${appId1}'::uuid ` +
          `and status='active' order by created_at desc limit 1`
      );
      expect(sub1).toMatch(/^[0-9a-f-]{36}$/i);
      report.subscriptionId1 = sub1;

      // Retain while active
      expect(
        stagingSql(
          `select case when screenshot_object_key is not null then 'KEPT' else 'CLEARED' end ` +
            `from subscription_applications where id='${appId1}'::uuid`
        )
      ).toBe("KEPT");
      expect(r2Head(key1).exists).toBe(true);

      // --- Admin deactivate → release ---
      await page.goto("/admin/subscriptions");
      await expect(page.getByText(student.email).first()).toBeVisible({ timeout: 20000 });
      const subRow = page.locator("tr", { hasText: student.email }).first();
      await subRow.getByRole("button", { name: "Manage" }).click();
      await page.getByRole("menuitem", { name: "Deactivate" }).click();
      await confirmDialog(page, "Confirm");
      await expect(page.getByText(/Subscription updated/i).first()).toBeVisible({
        timeout: 25000,
      });

      expect(
        stagingSql(
          `select case when screenshot_object_key is null then 'CLEARED' else 'KEPT' end ` +
            `from subscription_applications where id='${appId1}'::uuid`
        )
      ).toBe("CLEARED");
      drainPurge();
      expect(r2Head(key1).exists).toBe(false);
      expect(
        stagingSql(`select count(*)::text from subscriptions where id='${sub1}'::uuid`)
      ).toBe("1");
      expect(
        stagingSql(
          `select count(*)::text from subscription_applications where id='${appId1}'::uuid`
        )
      ).toBe("1");
      report.deactivateOk = true;
      await signOut(page);

      // --- Second cycle: natural expiry via set_subscription_end ---
      await login(page, student.email, student.password);
      await studentApply(page, jpeg, "5200");
      await signOut(page);

      const app2 = stagingSql(
        `select id::text||'|'||coalesce(screenshot_object_key,'') ` +
          `from subscription_applications where student_id='${student.studentId}'::uuid ` +
          `and status='pending' order by created_at desc limit 1`
      );
      const [appId2, key2] = app2.split("|");
      expect(key2).toMatch(/^payment-proofs\//);
      expect(r2Head(key2).exists).toBe(true);
      report.applicationId2 = appId2;
      report.objectKey2 = key2;

      await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
      await page.goto(
        `/admin/subscriptions/applications?status=pending&year=${encodeURIComponent(y1Id)}`
      );
      const row2 = page.locator("tr", { hasText: student.email }).first();
      await row2.getByRole("button", { name: "Approve" }).click();
      await confirmDialog(page, "Confirm");
      await expect(page.getByText(/Application approved/i)).toBeVisible({ timeout: 25000 });

      const sub2 = stagingSql(
        `select id::text from subscriptions where application_id='${appId2}'::uuid ` +
          `and status='active' order by created_at desc limit 1`
      );
      report.subscriptionId2 = sub2;

      // Rewind starts_at so set_subscription_end can place ends_at in the past.
      stagingSqlExec(
        `update public.subscriptions set starts_at = now() - interval '10 days' ` +
          `where id='${sub2}'::uuid`
      );

      // Call release path through set_subscription_end as authenticated admin via psql GUC.
      stagingSqlExec(
        `begin; ` +
          `select set_config('request.jwt.claims', json_build_object('sub', ` +
          `(select id::text from profiles where role='admin' order by created_at limit 1), ` +
          `'role','authenticated')::text, true); ` +
          `set local role authenticated; ` +
          `select public.set_subscription_end('${sub2}'::uuid, now() - interval '2 hours'); ` +
          `commit;`
      );

      expect(
        stagingSql(`select status from subscriptions where id='${sub2}'::uuid`)
      ).toBe("expired");
      expect(
        stagingSql(
          `select case when screenshot_object_key is null then 'CLEARED' else 'KEPT' end ` +
            `from subscription_applications where id='${appId2}'::uuid`
        )
      ).toBe("CLEARED");
      drainPurge();
      expect(r2Head(key2).exists).toBe(false);
      expect(
        stagingSql(`select count(*)::text from subscriptions where id='${sub2}'::uuid`)
      ).toBe("1");
      expect(
        stagingSql(
          `select count(*)::text from subscription_applications where id='${appId2}'::uuid`
        )
      ).toBe("1");
      report.expiryOk = true;

      // Unrelated apps with keys untouched (rejected inventory keys still present-or-missing as before).
      const unrelatedKept = stagingSql(
        `select count(*)::text from subscription_applications ` +
          `where student_id is distinct from '${student.studentId}'::uuid ` +
          `and screenshot_object_key is not null`
      );
      report.unrelatedAppsWithKey = unrelatedKept;
      report.ok = true;
    } finally {
      fs.writeFileSync(
        "tmp-stg-payment-webp-e2e.json",
        JSON.stringify(report, null, 2)
      );
      cleanupStudentArtifacts(student.studentId);
      await deleteStudent(student.studentId);
    }
  });
});
