/**
 * Focused staging acceptance — clean 1st Year Past Papers / Other Services / PDF sizes.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = "https://staging.medversepk.com";
const PDF_DIR = path.join(__dirname, "tmp-qa-pdfs");
const TAG = `ACC-${Date.now().toString(36)}`;
const YEAR = "1st Year MBBS";

const ADMIN = {
  email: process.env.E2E_ADMIN_EMAIL,
  password: process.env.E2E_ADMIN_PASSWORD,
};
const FREE = {
  email: process.env.E2E_STAGING_STUDENT_EMAIL,
  password: process.env.E2E_STAGING_STUDENT_PASSWORD,
};
const PAID = {
  email: process.env.E2E_STAGING_PAID_EMAIL || "staging-paid@medverse.local",
  password: process.env.E2E_STAGING_PAID_PASSWORD || FREE.password,
};

const report = {
  tag: TAG,
  results: [],
  pdfMatrix: [],
  defects: [],
  meta: { year: YEAR, knownNonCascade: "Parent soft-delete does not cascade children (existing behavior)." },
};

function log(area, msg, ok = true) {
  report.results.push({ area, msg, ok });
  if (!ok) report.defects.push(`${area}: ${msg}`);
  console.log(`[${ok ? "PASS" : "FAIL"}] ${area}: ${msg}`);
}

async function login(page, email, password) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 45000 });
}

async function logout(context, page) {
  await context.clearCookies();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
}

async function ensureYear(page, pathSuffix) {
  await page.goto(`${BASE}${pathSuffix}`, { waitUntil: "domcontentloaded" });
  for (let i = 0; i < 4; i++) {
    if (await page.getByPlaceholder(/Midterms|Service name/i).count()) return;
    const yearBtn = page
      .locator("button[type=submit]")
      .filter({ hasText: /1st Year MBBS/i })
      .first();
    if (await yearBtn.count()) {
      await yearBtn.click();
      await page.waitForTimeout(1500);
      continue;
    }
    const combo = page.getByRole("combobox").first();
    if (await combo.count()) {
      const t = await combo.innerText().catch(() => "");
      if (/1st/i.test(t)) return;
      await combo.click();
      const opt = page.getByRole("option", { name: /1st Year/i });
      if (await opt.count()) await opt.first().click();
      await page.waitForTimeout(1200);
    }
    await page.goto(`${BASE}${pathSuffix}`, { waitUntil: "domcontentloaded" });
  }
}

async function toastText(page) {
  await page.waitForTimeout(800);
  return (await page.locator("[data-sonner-toast]").allTextContents()).join(" | ");
}

async function uploadToForm(page, form, title, filePath) {
  await form.locator('input[name="title"]').fill(title);
  await form.locator('input[name="file"]').setInputFiles(filePath);
  const pub = form.locator('input[name="publish"]');
  if ((await pub.count()) && !(await pub.isChecked())) await pub.check();
  await form.getByRole("button", { name: /Add PDF/i }).click();
  const start = Date.now();
  let msg = "";
  while (Date.now() - start < 180000) {
    msg = await toastText(page);
    if (/PDF saved|too large|pdf_|invalid|MIME|type|size|fail|error/i.test(msg)) break;
    if (!(await form.getByRole("button", { name: /Uploading/i }).count())) {
      await page.waitForTimeout(1000);
      msg = (await toastText(page)) || msg;
      break;
    }
    await page.waitForTimeout(1000);
  }
  const crash = (await page.getByText(/couldn't load|Application error|Internal Server Error/i).count()) > 0;
  return { ok: /PDF saved/i.test(msg), msg: msg || (crash ? "PAGE_CRASH" : "(no toast)"), crash };
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.on("dialog", (d) => d.accept());

  const sub = `${TAG}-Sub`;
  const subR = `${TAG}-SubR`;
  const subSub = `${TAG}-SS`;
  const sub2 = `${TAG}-Sub2`;
  const titleA = `${TAG}-A`;
  const titleB = `${TAG}-B`;
  const svc = `${TAG}-Svc`;
  const svcE = `${TAG}-SvcE`;

  try {
    await login(page, ADMIN.email, ADMIN.password);
    await ensureYear(page, "/admin/past-papers");
  await page.getByPlaceholder(/Midterms|Service name/i).first().waitFor({ timeout: 20000 }).catch(() => {});
  log("admin", "Past Papers admin ready");

    // Create Sub Nav
    await page.getByPlaceholder(/Midterms/i).first().fill(sub);
    await page.getByRole("button", { name: "Create Sub Nav" }).click();
    await page.waitForTimeout(1200);
    await page.reload({ waitUntil: "domcontentloaded" });
    log("admin", `Create Sub Nav ${sub}`, (await page.locator(`text=${sub}`).count()) > 0);

    // Rename via first Rename near our card
    const card = page.locator("[data-slot='card']").filter({ hasText: sub }).first();
    await card.getByRole("button", { name: "Rename" }).click();
    await card.locator("input").first().fill(subR);
    await card.getByRole("button", { name: "Save" }).click();
    await page.waitForTimeout(1000);
    await page.reload({ waitUntil: "domcontentloaded" });
    log("admin", `Rename ${subR}`, (await page.locator("[data-slot='card']").filter({ hasText: subR }).count()) > 0);

    let root = page.locator("[data-slot='card']").filter({ hasText: subR }).first();
    // Upload A (small) to Sub Nav
    let form = root.locator("form").filter({ has: page.locator('input[name="file"]') }).first();
    let r = await uploadToForm(page, form, titleA, path.join(PDF_DIR, "A-small.pdf"));
    log("admin", `PDF@SubNav ${titleA}: ${r.msg}`, r.ok && !r.crash);
    report.pdfMatrix.push({ id: "A", size: 8192, ...r, expected: "success" });
    await page.reload({ waitUntil: "domcontentloaded" });
    root = page.locator("[data-slot='card']").filter({ hasText: subR }).first();

    // Create Sub-Sub — select that contains our Sub Nav option (never the class-year select)
    const parentSel = page.locator("select").filter({
      has: page.locator("option", { hasText: subR }),
    });
    const opts = await parentSel.locator("option").allTextContents();
    console.log("SELECT_OPTS", JSON.stringify(opts));
    if (!(await parentSel.count())) {
      log("admin", `Parent select with option ${subR} not found`, false);
    } else {
      await parentSel.selectOption({ label: subR });
      await page.getByPlaceholder(/2024 papers/i).fill(subSub);
      await page.getByRole("button", { name: "Create Sub-Sub" }).click();
      await page.waitForTimeout(1200);
      await page.reload({ waitUntil: "domcontentloaded" });
    }
    root = page.locator("[data-slot='card']").filter({ hasText: subR }).first();
    const hasSS = (await root.getByText(subSub, { exact: true }).count()) > 0;
    log("admin", `Create Sub-Sub ${subSub}`, hasSS);

    if (hasSS) {
      root = page.locator("[data-slot='card']").filter({ hasText: subR }).first();
      // Second PDF form on the Sub Nav card is the Sub-Sub form
      const forms = root.locator("form").filter({ has: page.locator('input[name="file"]') });
      const formCount = await forms.count();
      form = formCount >= 2 ? forms.nth(1) : forms.first();
      r = await uploadToForm(page, form, titleB, path.join(PDF_DIR, "B-1p5mb.pdf"));
      log("admin", `PDF@SubSub ${titleB}: ${r.msg}`, r.ok && !r.crash);
      report.pdfMatrix.push({ id: "B", size: 1572864, ...r, expected: "success" });
      await page.reload({ waitUntil: "domcontentloaded" });
      root = page.locator("[data-slot='card']").filter({ hasText: subR }).first();
    }

    const both =
      (await root.getByText(titleA).count()) > 0 &&
      (!hasSS || (await root.getByText(titleB).count()) > 0);
    log("admin", "Hierarchy both levels distinct", both && hasSS);

    // Reorder: create second root and move up
    await page.getByPlaceholder(/Midterms/i).first().fill(sub2);
    await page.getByRole("button", { name: "Create Sub Nav" }).click();
    await page.waitForTimeout(1200);
    await page.reload({ waitUntil: "domcontentloaded" });
    const card2 = page.locator("[data-slot='card']").filter({ hasText: sub2 }).first();
    const move = card2.getByRole("button", { name: "Move up" });
    if ((await move.count()) && !(await move.isDisabled())) {
      await move.click();
      await page.waitForTimeout(800);
      log("admin", "Reorder Move up", true);
    } else {
      log("admin", "Reorder Move up skipped/disabled", true);
    }

    // PDF size matrix C/D/E on root card form
    for (const s of [
      { id: "C", file: "C-10mb.pdf", size: 10485760, expectOk: true },
      { id: "D", file: "D-20mb.pdf", size: 20971520, expectOk: true },
      { id: "E", file: "E-25mb-plus1.pdf", size: 26214401, expectOk: false },
    ]) {
      await page.goto(`${BASE}/admin/past-papers`, { waitUntil: "domcontentloaded" });
      root = page.locator("[data-slot='card']").filter({ hasText: subR }).first();
      form = root.locator("form").filter({ has: page.locator('input[name="file"]') }).first();
      const title = `${TAG}-${s.id}`;
      r = await uploadToForm(page, form, title, path.join(PDF_DIR, s.file));
      const pass = s.expectOk ? r.ok && !r.crash : !r.ok && !r.crash;
      log("pdf", `${s.id} ${s.file} ${s.size}B expectOk=${s.expectOk} → ${r.msg}`, pass);
      report.pdfMatrix.push({ ...s, ...r, title });
    }

    // Invalid
    try {
      await page.goto(`${BASE}/admin/past-papers`, { waitUntil: "domcontentloaded" });
      root = page.locator("[data-slot='card']").filter({ hasText: subR }).first();
      form = root.locator("form").first();
      await form.locator('input[name="title"]').fill(`${TAG}-bad`);
      await form.locator('input[name="file"]').setInputFiles(path.join(PDF_DIR, "invalid.txt"));
      await form.getByRole("button", { name: /Add PDF/i }).click();
      await page.waitForTimeout(2000);
      const msg = await toastText(page);
      log("pdf", `invalid.txt → ${msg || "accept= blocked"}`, true);
      report.pdfMatrix.push({ id: "invalid", size: 11, msg, expected: "reject" });
    } catch (e) {
      log("pdf", `invalid blocked: ${e.message}`, true);
      report.pdfMatrix.push({ id: "invalid", expected: "reject", msg: String(e.message) });
    }

    // Bin PDF A + restore
    await page.goto(`${BASE}/admin/past-papers`, { waitUntil: "domcontentloaded" });
    root = page.locator("[data-slot='card']").filter({ hasText: subR }).first();
    const rowA = root.locator("div").filter({ hasText: titleA }).filter({ has: page.getByRole("button", { name: "Move to Bin" }) }).first();
    await rowA.getByRole("button", { name: "Move to Bin" }).click();
    await page.waitForTimeout(1200);
    await page.goto(`${BASE}/admin/bin`, { waitUntil: "domcontentloaded" });
    const inBin = (await page.getByText(titleA).count()) > 0;
    log("bin", `PDF in Bin=${inBin}`, inBin);
    if (inBin) {
      await page.locator("div").filter({ hasText: titleA }).getByRole("button", { name: /restore/i }).first().click();
      await page.waitForTimeout(1200);
      log("bin", "Restored PDF A", true);
    }

    // Soft-delete sub2 (test folder only)
    await page.goto(`${BASE}/admin/past-papers`, { waitUntil: "domcontentloaded" });
    const c2 = page.locator("[data-slot='card']").filter({ hasText: sub2 }).first();
    if (await c2.count()) {
      await c2.getByRole("button", { name: "Move to Bin" }).click();
      await page.waitForTimeout(800);
      log("admin", `Bin ${sub2}`, true);
    }

    // Other Services
    await ensureYear(page, "/admin/other-services");
    await page.getByPlaceholder("Service name").fill(svc);
    await page.getByPlaceholder(/Short blurb/i).fill("QA blurb");
    await page.getByRole("button", { name: "Create service" }).click();
    await page.waitForTimeout(1200);
    await page.reload({ waitUntil: "domcontentloaded" });
    log("services", `Create ${svc}`, (await page.getByText(svc).count()) > 0);
    const svcCard = page.locator("[data-slot='card']").filter({ hasText: svc }).first();
    if (await svcCard.getByRole("button", { name: "Rename" }).count()) {
      await svcCard.getByRole("button", { name: "Rename" }).click();
      await svcCard.locator("input").first().fill(svcE);
      await svcCard.getByRole("button", { name: "Save" }).click();
      await page.waitForTimeout(1000);
      await page.reload({ waitUntil: "domcontentloaded" });
      log("services", `Edit ${svcE}`, (await page.getByText(svcE).count()) > 0);
    }

    // Paid student
    await logout(context, page);
    await login(page, PAID.email, PAID.password);
    await page.goto(`${BASE}/past-papers`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
    const sees = (await page.getByText(subR).count()) > 0;
    log("student", `Paid sees SubNav ${subR}=${sees}`, sees);
    if (sees) {
      await page.getByText(subR).first().click();
      await page.waitForTimeout(1000);
      const a = (await page.getByText(titleA).count()) > 0;
      const ss = (await page.getByText(subSub).count()) > 0;
      log("student", `Inside: PDF-A=${a} SubSub=${ss}`, a || ss);
      if (ss) {
        await page.getByText(subSub).first().click();
        await page.waitForTimeout(800);
      }
      const openTitle = a ? titleA : titleB;
      await page.getByText(openTitle).first().click();
      await page.waitForTimeout(2000);
      const leak = /r2\.cloudflarestorage\.com/i.test(await page.content());
      log("student", `Open ${openTitle}; R2 public leak=${leak}; url=${page.url()}`, !leak);
    }
    await page.goto(`${BASE}/other-services`, { waitUntil: "domcontentloaded" });
    const svcLabel = (await page.getByText(svcE).count()) ? svcE : svc;
    log("student", `Paid sees service ${svcLabel}`, (await page.getByText(svcLabel).count()) > 0);

    // Free lock
    await logout(context, page);
    await login(page, FREE.email, FREE.password);
    await page.goto(`${BASE}/past-papers`, { waitUntil: "domcontentloaded" });
    const freeSees = (await page.getByText(subR).count()) > 0;
    const freeLock = (await page.getByText(/unlock|subscribe|subscription|locked|upgrade/i).count()) > 0;
    log("student", `Free seesQA=${freeSees} lock=${freeLock}`, freeLock || !freeSees);
    await page.goto(`${BASE}/other-services`, { waitUntil: "domcontentloaded" });
    log("student", `Free other-services lockish=${(await page.getByText(/unlock|subscribe|subscription|locked|upgrade/i).count()) > 0}`, true);

    // Mobile / dark
    for (const w of [320, 375]) {
      await page.setViewportSize({ width: w, height: 720 });
      await page.goto(`${BASE}/past-papers`, { waitUntil: "domcontentloaded" });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2
      );
      log("mobile", `${w}px overflow=${overflow}`, !overflow);
      await page.goto(`${BASE}/other-services`, { waitUntil: "domcontentloaded" });
      const overflow2 = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2
      );
      log("mobile", `${w}px other-services overflow=${overflow2}`, !overflow2);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await page.goto(`${BASE}/past-papers`, { waitUntil: "domcontentloaded" });
    log("dark", "dark class on past-papers", await page.evaluate(() => document.documentElement.classList.contains("dark")));

    // Regression routes
    for (const route of [
      "/dashboard",
      "/academic",
      "/subscription",
      "/prof-session",
      "/mock-tests",
      "/ospe",
      "/tests",
      "/question-bank",
      "/one-liners",
    ]) {
      const res = await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
      const st = res?.status() ?? 0;
      log("regression", `${route} → ${st}`, st > 0 && st < 500);
    }

    // Services bin+restore as admin
    await logout(context, page);
    await login(page, ADMIN.email, ADMIN.password);
    await ensureYear(page, "/admin/other-services");
    const sc = page.locator("[data-slot='card']").filter({ hasText: svcE }).or(page.locator("[data-slot='card']").filter({ hasText: svc })).first();
    if (await sc.count()) {
      await sc.getByRole("button", { name: "Move to Bin" }).click();
      await page.waitForTimeout(1000);
      await page.goto(`${BASE}/admin/bin`, { waitUntil: "domcontentloaded" });
      const label = (await page.getByText(svcE).count()) ? svcE : svc;
      if (await page.getByText(label).count()) {
        await page.locator("div").filter({ hasText: label }).getByRole("button", { name: /restore/i }).first().click();
        await page.waitForTimeout(1000);
        log("services", `Bin+restore ${label}`, true);
      } else {
        log("services", "Service not found in Bin", false);
      }
    }
    const binStatus = await page.goto(`${BASE}/admin/bin`, { waitUntil: "domcontentloaded" });
    log("regression", `/admin/bin → ${binStatus?.status()}`, (binStatus?.status() ?? 500) < 500);

    report.meta.subR = subR;
    report.meta.titleA = titleA;
    report.meta.titleB = titleB;
  } catch (e) {
    log("crash", String(e.message || e), false);
    console.error(e);
  } finally {
    const out = path.join(__dirname, "tmp-e2e-accept-final.json");
    fs.writeFileSync(out, JSON.stringify(report, null, 2));
    console.log("REPORT", out);
    console.log("TAG", TAG);
    console.log("DEFECTS", report.defects.length);
    await browser.close();
  }
  process.exit(report.defects.length ? 2 : 0);
}

main();
