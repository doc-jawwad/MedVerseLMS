/**
 * Diagnostic: upload A/B/C/D/E on existing or new Sub Nav; capture network + console.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = "https://staging.medversepk.com";
const PDF_DIR = path.join(__dirname, "tmp-qa-pdfs");
const TAG = `SZ-${Date.now().toString(36)}`;

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const net = [];
  page.on("response", async (res) => {
    const url = res.url();
    if (!url.includes("staging.medversepk.com")) return;
    if (res.request().method() === "POST" || res.status() >= 400) {
      let body = "";
      try {
        body = (await res.text()).slice(0, 300);
      } catch {}
      net.push({
        status: res.status(),
        url: url.slice(0, 180),
        method: res.request().method(),
        body,
      });
    }
  });
  page.on("console", (m) => {
    if (["error", "warning"].includes(m.type())) {
      net.push({ console: m.type(), text: m.text().slice(0, 300) });
    }
  });
  page.on("pageerror", (e) => net.push({ pageerror: String(e.message).slice(0, 300) }));

  await page.goto(`${BASE}/login`);
  await page.getByLabel("Email").fill(process.env.E2E_ADMIN_EMAIL);
  await page.getByLabel("Password").fill(process.env.E2E_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 45000 });

  await page.goto(`${BASE}/admin/past-papers`);
  // Class picker or already selected
  for (let i = 0; i < 3; i++) {
    if (await page.getByPlaceholder(/Midterms/i).count()) break;
    // Picker cards: button containing year name
    const yearBtn = page.locator("button[type=submit]").filter({ hasText: /1st Year MBBS/i }).first();
    if (await yearBtn.count()) {
      await yearBtn.click();
      await page.waitForTimeout(1500);
      continue;
    }
    // Header combobox already on another year
    const combo = page.getByRole("combobox").first();
    if (await combo.count()) {
      await combo.click();
      const opt = page.getByRole("option", { name: /1st Year/i });
      if (await opt.count()) await opt.first().click();
      else {
        const sel = page.locator("select").filter({ has: page.locator("option", { hasText: /1st Year/ }) }).first();
        if (await sel.count()) await sel.selectOption({ index: 1 }).catch(() => sel.selectOption({ label: "1st Year MBBS" }));
      }
      await page.waitForTimeout(1500);
    }
    await page.goto(`${BASE}/admin/past-papers`);
  }
  await page.getByPlaceholder(/Midterms/i).first().waitFor({ timeout: 20000 });

  const sub = `${TAG}-Sub`;
  await page.getByPlaceholder(/Midterms/i).first().fill(sub);
  await page.getByRole("button", { name: "Create Sub Nav" }).click();
  await page.waitForTimeout(1500);
  await page.reload();

  const results = [];
  for (const s of [
    { id: "A", file: "A-small.pdf" },
    { id: "B", file: "B-1p5mb.pdf" },
    { id: "C", file: "C-10mb.pdf" },
    { id: "D", file: "D-20mb.pdf" },
    { id: "E", file: "E-25mb-plus1.pdf" },
  ]) {
    net.length = 0;
    await page.goto(`${BASE}/admin/past-papers`);
    const card = page.locator("[data-slot='card']").filter({ hasText: sub }).first();
    await card.waitFor({ timeout: 15000 });
    const form = card.locator("form").filter({ has: page.locator('input[name="file"]') }).first();
    const title = `${TAG}-${s.id}`;
    const fp = path.join(PDF_DIR, s.file);
    const size = fs.statSync(fp).size;
    await form.locator('input[name="title"]').fill(title);
    await form.locator('input[name="file"]').setInputFiles(fp);
    const t0 = Date.now();
    await form.getByRole("button", { name: /Add PDF/i }).click();
    // wait up to 3 min
    let msg = "";
    let crash = false;
    while (Date.now() - t0 < 180000) {
      const toasts = await page.locator("[data-sonner-toast]").allTextContents();
      if (toasts.length) {
        msg = toasts.join(" | ");
        if (/PDF saved|too large|pdf_|invalid|error|fail|size|type/i.test(msg)) break;
      }
      crash = (await page.getByText(/couldn't load|Application error|Internal Server Error|500/i).count()) > 0;
      if (crash) {
        msg = "PAGE_CRASH";
        break;
      }
      const uploading = await form.getByRole("button", { name: /Uploading/i }).count();
      if (!uploading && Date.now() - t0 > 5000) {
        await page.waitForTimeout(1500);
        msg = (await page.locator("[data-sonner-toast]").allTextContents()).join(" | ") || msg || "(idle no toast)";
        break;
      }
      await page.waitForTimeout(1000);
    }
    const elapsed = Date.now() - t0;
    const ok = /PDF saved/i.test(msg);
    // verify DB-visible title on page after reload
    await page.reload().catch(() => {});
    const visible = (await page.getByText(title).count()) > 0;
    results.push({
      id: s.id,
      file: s.file,
      size,
      elapsedMs: elapsed,
      msg,
      ok,
      visible,
      crash,
      net: [...net],
    });
    console.log(JSON.stringify(results[results.length - 1], null, 2));
  }

  // Create Sub-Sub with correct select
  await page.goto(`${BASE}/admin/past-papers`);
  const parentSel = page.locator("select").filter({ has: page.locator("option", { hasText: sub }) });
  console.log("parentSel count", await parentSel.count());
  if (await parentSel.count()) {
    await parentSel.selectOption({ label: sub });
    const ss = `${TAG}-SS`;
    await page.getByPlaceholder(/2024 papers/i).fill(ss);
    await page.getByRole("button", { name: "Create Sub-Sub" }).click();
    await page.waitForTimeout(1500);
    await page.reload();
    const has = await page.locator("[data-slot='card']").filter({ hasText: sub }).getByText(ss).count();
    console.log("SUBSUB", ss, has > 0);
  }

  fs.writeFileSync(path.join(__dirname, "tmp-pdf-size-diag.json"), JSON.stringify({ tag: TAG, results }, null, 2));
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
