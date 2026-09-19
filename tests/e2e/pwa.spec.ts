import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

test.describe("PWA installability", () => {
  test("serves a valid web app manifest with MedVerse icons", async ({
    request,
  }) => {
    const res = await request.get("/manifest.webmanifest");
    expect(res.ok()).toBeTruthy();
    const manifest = (await res.json()) as {
      name: string;
      short_name: string;
      display: string;
      start_url: string;
      scope: string;
      theme_color: string;
      icons: { src: string; sizes: string; purpose?: string }[];
    };
    expect(manifest.name).toBe("MedVerse");
    expect(manifest.short_name).toBe("MedVerse");
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
    expect(manifest.theme_color.toLowerCase()).toBe("#072855");
    const sizes = manifest.icons.map((i) => i.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    expect(manifest.icons.some((i) => i.purpose === "maskable")).toBeTruthy();
    for (const icon of manifest.icons) {
      const iconRes = await request.get(icon.src);
      expect(iconRes.ok(), icon.src).toBeTruthy();
      expect(iconRes.headers()["content-type"] ?? "").toMatch(/image\/png/);
    }
  });

  test("service worker is public and refuses protected-content caching", async ({
    request,
  }) => {
    const res = await request.get("/sw.js");
    expect(res.ok()).toBeTruthy();
    expect(res.headers()["content-type"] ?? "").toMatch(/javascript/);
    const body = await res.text();
    expect(body).toContain("/rest/v1");
    expect(body).toContain("/auth/v1");
    expect(body).toContain("payment-proof");
    expect(body).not.toMatch(/addEventListener\("install"/);
    const onDisk = readFileSync(path.join(process.cwd(), "public/sw.js"), "utf8");
    expect(body.replace(/\r\n/g, "\n")).toContain("medverse-static-v1");
    expect(onDisk).toContain("medverse-static-v1");
  });

  test("login offers Install MedVerse App and iOS guidance", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    await page.goto("/login");
    const install = page.getByTestId("install-medverse-app");
    await expect(install).toBeVisible();
    await expect(install).toHaveText(/Install MedVerse App/);
    await install.click();
    await expect(page.getByText("Install on iPhone")).toBeVisible();
    await expect(page.getByText(/Open MedVerse in Safari/)).toBeVisible();
    await expect(page.getByText(/Add to Home Screen/)).toBeVisible();
    await expect(page.getByText(/App Store download/i)).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    );
    expect(overflow).toBeFalsy();
    await context.close();
  });

  test("unsupported-browser fallback explains menu install", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto("/login");
    await page.getByTestId("install-medverse-app").click();
    await expect(page.getByText(/does not expose a one-tap install prompt/i)).toBeVisible();
  });

  test("standalone mode reports Installed and does not nag", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 360, height: 740 },
    });
    const page = await context.newPage();
    await page.addInitScript(() => {
      Object.defineProperty(window, "matchMedia", {
        writable: true,
        value: (query: string) => ({
          matches: query.includes("display-mode: standalone"),
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
          addListener: () => {},
          removeListener: () => {},
          dispatchEvent: () => false,
        }),
      });
    });
    await page.goto("/login");
    const install = page.getByTestId("install-medverse-app");
    await expect(install).toHaveText(/Installed/);
    await expect(install).toBeDisabled();
    await context.close();
  });

  test("Android-style beforeinstallprompt is launched from the button", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36",
      viewport: { width: 412, height: 915 },
    });
    const page = await context.newPage();
    await page.goto("/login");
    await page.evaluate(() => {
      const event = new Event("beforeinstallprompt");
      Object.defineProperty(event, "prompt", {
        value: async () => {
          (window as Window & { __medversePrompted?: boolean }).__medversePrompted =
            true;
        },
      });
      Object.defineProperty(event, "userChoice", {
        value: Promise.resolve({ outcome: "accepted" }),
      });
      window.dispatchEvent(event);
    });
    await expect
      .poll(async () =>
        page.getByTestId("install-medverse-app").getAttribute("data-install-state")
      )
      .toBe("android-install");
    await page.getByTestId("install-medverse-app").click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            Boolean(
              (window as Window & { __medversePrompted?: boolean }).__medversePrompted
            )
        )
      )
      .toBeTruthy();
    await context.close();
  });

  test("320px landing layout does not overflow horizontally", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto("/");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    );
    expect(overflow).toBeFalsy();
  });
});
