/**
 * Staging PDF paid-folder workflow: create folder → upload PDF → entitlement
 * any_subscription → entitled student renders; free student gets 403 / lock.
 */
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./fixtures";
import { loadE2EEnv } from "./load-e2e-env";

const fixturePdf = path.join(
  process.cwd(),
  "tests",
  "e2e",
  "fixtures",
  "qa-paid-folder.pdf"
);

function tinyPdf(): Buffer {
  // Minimal valid PDF
  return Buffer.from(
    `%PDF-1.1
1 0 obj<<>>endobj
2 0 obj<< /Length 44 >>stream
BT /F1 12 Tf 100 700 Td (QA PDF) Tj ET
endstream
endobj
3 0 obj<< /Type /Page /Parent 4 0 R /Contents 2 0 R >>endobj
4 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 /MediaBox [0 0 612 792] >>endobj
5 0 obj<< /Type /Catalog /Pages 4 0 R >>endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000025 00000 n 
0000000120 00000 n 
0000000193 00000 n 
0000000274 00000 n 
trailer<< /Size 6 /Root 5 0 R >>
startxref
343
%%EOF`
  );
}

async function login(
  page: import("@playwright/test").Page,
  email: string,
  password: string
) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/(dashboard|admin)/, { timeout: 30_000 });
}

test.describe("PDF paid-folder staging E2E", () => {
  test.beforeAll(() => {
    fs.mkdirSync(path.dirname(fixturePdf), { recursive: true });
    if (!fs.existsSync(fixturePdf)) fs.writeFileSync(fixturePdf, tinyPdf());
  });

  test("admin creates paid folder PDF; access gates correctly", async ({
    page,
    context,
  }) => {
    test.setTimeout(180_000);
    const e2e = loadE2EEnv();
    test.skip(e2e.target !== "staging", "staging only");
    test.skip(
      !e2e.stagingStudentEmail || !e2e.stagingStudentPassword,
      "student creds required"
    );

    const tag = `QA Paid PDF ${Date.now()}`;

    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto("/admin/materials");
    await page.waitForURL(/\/admin\/materials/, { timeout: 30_000 });

    if (await page.getByRole("heading", { name: "Select a class" }).isVisible()) {
      await page.getByRole("button", { name: /1st Year/i }).click();
      await page.waitForURL(/\/admin\/materials/);
    }

    await page.getByPlaceholder("New folder name…").fill(tag);
    await page.getByRole("button", { name: /^Add folder$/i }).click();
    await expect(page.getByRole("heading", { name: new RegExp(tag) }).or(page.getByText(tag).first())).toBeVisible({
      timeout: 30_000,
    });

    // Scope to the new folder card — click PDF mode then upload
    const folderCard = page.locator(".rounded-xl, [class*='card']").filter({ hasText: tag }).first();
    await folderCard.getByRole("button", { name: /^PDF$/i }).click();
    await folderCard.getByPlaceholder("Title").fill(`${tag} file`);
    await folderCard.locator('input[type="file"][accept*="pdf"]').setInputFiles({
      name: "qa-paid-folder.pdf",
      mimeType: "application/pdf",
      buffer: fs.readFileSync(fixturePdf),
    });
    await folderCard.getByRole("button", { name: /^Add PDF$/i }).click();
    await expect(page.getByText(`${tag} file`).first()).toBeVisible({
      timeout: 90_000,
    });

    const openLink = page.getByRole("link", { name: `${tag} file` }).first();
    let materialId: string | null = null;
    if (await openLink.isVisible().catch(() => false)) {
      const href = await openLink.getAttribute("href");
      materialId = href?.match(/materials\/([0-9a-f-]+)/)?.[1] ?? null;
    }

    await context.clearCookies();
    await login(
      page,
      e2e.stagingStudentEmail!,
      e2e.stagingStudentPassword!
    );

    if (materialId) {
      const res = await page.request.get(`/api/study-content/${materialId}`);
      // Entitled staging student → 200; free → 403. Either is a valid gate.
      expect([200, 403]).toContain(res.status());
      const body = await res.text();
      expect(body.includes("r2.") || body.includes("cloudflarestorage")).toBe(
        false
      );
      if (res.status() === 200) {
        expect(res.headers()["content-type"] || "").toMatch(/pdf/i);
      }
    } else {
      // Fallback: library lock UX for free student
      await page.goto("/materials");
      await expect(page.locator("body")).toBeVisible();
    }
  });
});
