import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

describe("resource entitlement refresh wiring", () => {
  const action = readFileSync(
    join(process.cwd(), "src/lib/actions/enrollment.ts"),
    "utf8"
  );
  const select = readFileSync(
    join(process.cwd(), "src/components/admin/entitlement-select.tsx"),
    "utf8"
  );
  const entitlementAction = action.slice(action.indexOf("export async function setResourceEntitlement("));

  it("invalidates student Academic and Free Resources routes after a successful entitlement update", () => {
    assert.match(entitlementAction, /if \(error\) return actionRpcResult\("action", error\)/);
    for (const pattern of [
      "/academic/[block]/[category]",
      "/academic/[block]/[category]/f/[folderId]",
      "/free-resources/[type]",
    ]) {
      assert.ok(
        entitlementAction.includes('revalidatePath("' + pattern + '", "page")'),
        "missing student route revalidation: " + pattern
      );
    }
  });

  it("refreshes the admin selector only on a successful server action", () => {
    assert.match(select, /useRouter/);
    assert.match(select, /if \(error\) toast\.error\(error\);\s*else \{\s*[\s\S]*router\.refresh\(\)/);
  });
});
