/**
 * Diagnose why PDF viewer stays on loading.
 */
import { test } from "@playwright/test";
import { loadE2EEnv } from "./load-e2e-env";

const MATERIAL_ID =
  process.env.E2E_PDF_MATERIAL_ID || "2607b1b5-632a-40c5-a907-769df99a6d92";

test("diag pdf load", async ({ page }) => {
  test.setTimeout(180_000);
  const e2e = loadE2EEnv();
  const nets: string[] = [];
  page.on("console", (m) => nets.push(`CONSOLE ${m.type()}: ${m.text()}`));
  page.on("pageerror", (e) => nets.push(`PAGEERROR ${e.message}`));
  page.on("response", (r) => {
    if (r.url().includes("study-content") || r.url().includes("pdf.worker")) {
      nets.push(`RESP ${r.status()} ${r.request().method()} ${r.url().slice(0, 120)}`);
    }
  });
  page.on("requestfailed", (r) => {
    nets.push(`FAIL ${r.failure()?.errorText} ${r.url().slice(0, 120)}`);
  });

  await page.goto("/login");
  await page.getByLabel("Email").fill(e2e.stagingStudentEmail!);
  await page.getByLabel("Password").fill(e2e.stagingStudentPassword!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/dashboard|academic|materials|library/, { timeout: 60_000 });

  const head = await page.request.fetch(`/api/study-content/${MATERIAL_ID}`, {
    method: "HEAD",
  });
  nets.push(`API_HEAD ${head.status()} cl=${head.headers()["content-length"]} ar=${head.headers()["accept-ranges"]}`);

  const partial = await page.request.get(`/api/study-content/${MATERIAL_ID}`, {
    headers: { Range: "bytes=0-7" },
  });
  const body = await partial.body();
  nets.push(`API_RANGE ${partial.status()} magic=${body.subarray(0, 5).toString("utf8")}`);

  await page.goto(`/materials/${MATERIAL_ID}/read`);
  await page.waitForTimeout(60_000);
  const loading = await page.getByTestId("pdf-loading").count();
  const viewer = await page.getByTestId("pdf-viewer").count();
  const err = await page.getByTestId("pdf-error").count();
  nets.push(`UI loading=${loading} viewer=${viewer} error=${err}`);
  nets.push(`TEXT ${(await page.locator("main").innerText()).slice(0, 500)}`);
  console.log(nets.join("\n"));
});
