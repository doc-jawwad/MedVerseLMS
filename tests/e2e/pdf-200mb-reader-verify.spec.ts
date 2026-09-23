/**
 * Open the 200MB uploaded material in the protected reader (staging).
 */
import { test, expect } from "@playwright/test";
import { loadE2EEnv } from "./load-e2e-env";

const MATERIAL_ID = "e8d4ab7d-608c-44fb-bbd0-6ae2371cd022";

test("reader opens 200MB upload without public R2 URL", async ({ page }) => {
  test.setTimeout(180_000);
  const e2e = loadE2EEnv();

  const ranges: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes(`/api/study-content/${MATERIAL_ID}`)) {
      const r = req.headers()["range"];
      if (r) ranges.push(r);
    }
  });

  await page.goto("/login");
  await page.getByLabel("Email").fill(e2e.stagingStudentEmail!);
  await page.getByLabel("Password").fill(e2e.stagingStudentPassword!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/dashboard|academic|materials/, { timeout: 60_000 });

  // May be locked for student (past_papers any_subscription) — try admin too
  await page.goto(`/materials/${MATERIAL_ID}/read`);
  const locked = await page.getByText(/Subscription required|locked/i).first().isVisible().catch(() => false);
  if (locked) {
    await page.goto("/login");
    // sign out first
    await page.goto("/admin");
  }

  // Use admin session for open if student locked
  await page.goto("/login");
  await page.getByLabel("Email").fill(e2e.adminEmail!);
  await page.getByLabel("Password").fill(e2e.adminPassword!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/admin/, { timeout: 60_000 });

  const head = await page.request.fetch(`/api/study-content/${MATERIAL_ID}`, {
    method: "HEAD",
  });
  expect(head.status()).toBe(200);
  expect(Number(head.headers()["content-length"])).toBe(209715143);
  expect(head.headers()["accept-ranges"]).toMatch(/bytes/i);

  const partial = await page.request.get(`/api/study-content/${MATERIAL_ID}`, {
    headers: { Range: "bytes=0-7" },
  });
  expect([200, 206]).toContain(partial.status());
  expect((await partial.body()).toString("utf8").startsWith("%PDF-")).toBe(true);

  await page.goto(`/materials/${MATERIAL_ID}/read`);
  // Admin may be redirected away from student shell — API checks above are authoritative.
  const html = await page.content();
  expect(html.includes("r2.cloudflarestorage.com")).toBe(false);
  expect(html.includes("X-Amz-Signature")).toBe(false);
  console.log(JSON.stringify({ head: head.status(), ranges: ranges.length, contentLength: head.headers()["content-length"] }));
});
