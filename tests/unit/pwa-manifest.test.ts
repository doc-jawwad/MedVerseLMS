import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import sharp from "sharp";
import manifest from "../../src/app/manifest.ts";

describe("PWA manifest and icons", () => {
  it("declares MedVerse standalone install metadata", () => {
    const m = manifest();
    assert.equal(m.name, "MedVerse");
    assert.equal(m.short_name, "MedVerse");
    assert.equal(m.display, "standalone");
    assert.equal(m.start_url, "/");
    assert.equal(m.scope, "/");
    assert.equal(m.theme_color, "#072855");
    assert.equal(m.background_color, "#072855");
    assert.equal(m.prefer_related_applications, false);
  });

  it("ships 192, 512, and maskable PNG icons on disk", async () => {
    const m = manifest();
    const icons = m.icons ?? [];
    const sizes = icons.map((i) => i.sizes);
    assert.ok(sizes.includes("192x192"));
    assert.ok(sizes.includes("512x512"));
    assert.ok(icons.some((i) => i.purpose === "maskable"));
    for (const icon of icons) {
      const file = path.join(process.cwd(), "public", icon.src.replace(/^\//, ""));
      assert.equal(existsSync(file), true, icon.src);
      const meta = await sharp(file).metadata();
      const [w, h] = (icon.sizes ?? "0x0").split("x").map(Number);
      assert.equal(meta.width, w);
      assert.equal(meta.height, h);
      assert.equal(meta.format, "png");
    }
    const apple = path.join(process.cwd(), "public/icons/apple-touch-icon.png");
    assert.equal(existsSync(apple), true);
  });
});
