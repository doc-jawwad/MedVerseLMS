import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("paid material folder creation (addFolder)", () => {
  const materials = readFileSync(
    join(process.cwd(), "src/lib/actions/materials.ts"),
    "utf8"
  );
  const protect = readFileSync(
    join(
      process.cwd(),
      "supabase/migrations/20260915034353_resource_entitlement.sql"
    ),
    "utf8"
  );

  it("never INSERTs paid entitlement directly; uses set_resource_entitlement", () => {
    assert.match(
      materials,
      /\.insert\(\{[\s\S]*?entitlement:\s*"free"[\s\S]*?\}\)/
    );
    assert.match(materials, /rpc\(\s*"set_resource_entitlement"/);
    assert.match(materials, /p_kind:\s*"materials_folder"/);
    assert.match(materials, /if \(entitlement !== "free"\)/);
  });

  it("rolls back the folder if entitlement RPC fails", () => {
    assert.match(
      materials,
      /if \(entError\) \{[\s\S]*\.delete\(\)\.eq\("id", folder\.id\)/
    );
  });

  it("keeps protect_resource_entitlement INSERT=free-only contract", () => {
    assert.match(
      protect,
      /if tg_op = 'INSERT' then[\s\S]*entitlement is not distinct from 'free'/
    );
    assert.match(
      protect,
      /entitlement changes require set_resource_entitlement\(\)/
    );
  });
});
