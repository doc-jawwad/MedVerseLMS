import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isYoutubeUrl, youtubeEmbedSrc } from "../../src/lib/library/media-url.ts";
import { yearDisplayName, parseLibrarySlug } from "../../src/lib/library/types.ts";
import { isYearId } from "../../src/lib/admin/year-id.ts";
import { MEDVERSE_CONTACT_LINKS } from "../../src/lib/contact/medverse-contact.ts";
import {
  isHistoryTestsPageState,
  isIncomingDashboardTest,
  testPricingLabel,
} from "../../src/lib/tests/student-test-state.ts";

describe("youtube detection", () => {
  it("builds embed URLs and rejects non-youtube https", () => {
    assert.equal(
      youtubeEmbedSrc("https://www.youtube.com/watch?v=abc123"),
      "https://www.youtube.com/embed/abc123"
    );
    assert.equal(
      youtubeEmbedSrc("https://youtu.be/xyz"),
      "https://www.youtube.com/embed/xyz"
    );
    assert.equal(isYoutubeUrl("https://drive.google.com/file/d/1"), false);
  });
});

describe("library helpers", () => {
  it("parses slugs and formats year names", () => {
    assert.equal(parseLibrarySlug("ospe-material"), "ospe_material");
    assert.equal(parseLibrarySlug("nope"), null);
    assert.equal(
      yearDisplayName({ year_number: 1, name: "1st Year MBBS" }),
      "1st Year MBBS"
    );
    assert.equal(yearDisplayName({ year_number: 5 }), "Final Year MBBS");
  });
});

describe("admin year id", () => {
  it("accepts uuids only", () => {
    assert.equal(isYearId("11111111-1111-1111-1111-111111111111"), true);
    assert.equal(isYearId("not-a-year"), false);
  });
});

describe("contact links", () => {
  it("includes hardcoded MedVerse channels", () => {
    const hrefs = MEDVERSE_CONTACT_LINKS.map((l) => l.href);
    assert.ok(hrefs.includes("https://wa.me/923019569240"));
    assert.ok(hrefs.includes("https://wa.me/medversepk"));
    assert.ok(hrefs.some((h) => h.startsWith("mailto:medversepakistan@gmail.com")));
    assert.ok(hrefs.some((h) => h.includes("whatsapp.com/channel")));
    assert.ok(hrefs.some((h) => h.includes("instagram.com/medverse_pakistan")));
    assert.ok(hrefs.some((h) => h.includes("youtube.com/@medversepakistan")));
    assert.ok(hrefs.some((h) => h.includes("facebook.com/share")));
  });
});

describe("test surface split", () => {
  it("maps incoming vs history and FREE/PAID labels", () => {
    assert.equal(isIncomingDashboardTest("upcoming"), true);
    assert.equal(isIncomingDashboardTest("available"), true);
    assert.equal(isIncomingDashboardTest("result"), false);
    assert.equal(isHistoryTestsPageState("result"), true);
    assert.equal(isHistoryTestsPageState("upcoming"), false);
    assert.equal(testPricingLabel("free"), "FREE");
    assert.equal(testPricingLabel("any_subscription"), "PAID");
    assert.equal(testPricingLabel("plan"), "PAID");
  });
});
