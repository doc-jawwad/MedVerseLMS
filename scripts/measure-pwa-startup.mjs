/**
 * Measure PWA start_url "/" paint timing under optional Playwright network throttle.
 * Usage:
 *   node scripts/measure-pwa-startup.mjs
 *   BASE_URL=https://staging.medversepk.com THROTTLE=slow3g node scripts/measure-pwa-startup.mjs
 */
import { chromium, devices } from "@playwright/test";

const BASE = (process.env.BASE_URL || "https://staging.medversepk.com").replace(
  /\/$/,
  ""
);
const THROTTLE = (process.env.THROTTLE || "none").toLowerCase();

const PROFILES = {
  none: null,
  slow3g: {
    offline: false,
    downloadThroughput: ((500 * 1000) / 8) * 0.8,
    uploadThroughput: ((500 * 1000) / 8) * 0.8,
    latency: 400,
  },
  fast3g: {
    offline: false,
    downloadThroughput: ((1.6 * 1000 * 1000) / 8) * 0.9,
    uploadThroughput: ((750 * 1000) / 8) * 0.9,
    latency: 150,
  },
  offline: { offline: true },
};

async function measure(label, contextFactory) {
  const browser = await chromium.launch({ headless: true });
  const context = await contextFactory(browser);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  const profile = PROFILES[THROTTLE];
  if (profile) {
    await cdp.send("Network.emulateNetworkConditions", {
      offline: Boolean(profile.offline),
      latency: profile.latency ?? 0,
      downloadThroughput: profile.downloadThroughput ?? -1,
      uploadThroughput: profile.uploadThroughput ?? -1,
      connectionType: "cellular3g",
    });
  }

  const t0 = Date.now();
  let splashMs = null;
  let landingOrNavMs = null;

  const splashWait = page
    .waitForSelector('[data-testid="pwa-boot-splash"]', { timeout: 30000 })
    .then(() => {
      splashMs = Date.now() - t0;
    })
    .catch(() => {});

  await page.goto(`${BASE}/`, { waitUntil: "commit", timeout: 60000 });
  await splashWait;

  await Promise.race([
    page
      .waitForSelector('a[href="/login"]', { timeout: 15000 })
      .then(() => {
        landingOrNavMs = Date.now() - t0;
      })
      .catch(() => {}),
    page
      .waitForURL(/\/(dashboard|admin|login)/, { timeout: 15000 })
      .then(() => {
        landingOrNavMs = Date.now() - t0;
      })
      .catch(() => {}),
  ]);

  const html = await page.content();
  const hasSplashMarkup =
    html.includes("pwa-boot-splash") || html.includes("MedDesk.pk");
  const result = {
    label,
    base: BASE,
    throttle: THROTTLE,
    splash_ms: splashMs,
    interactive_ms: landingOrNavMs,
    has_splash_markup: hasSplashMarkup,
    final_url: page.url(),
  };
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
  return result;
}

await measure("cold-ish", async (browser) =>
  browser.newContext({
    ...devices["Pixel 7"],
    serviceWorkers: "allow",
  })
);
