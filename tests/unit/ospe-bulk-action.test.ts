import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import ts from "typescript";
import { validateOspeBulkItem, matchesOspeBulkReplay } from "../../src/lib/admin/ospe-bulk.ts";
import { isOspeStationImageFile } from "../../src/lib/study/upload-rules.ts";

// Execute the actual action module with a closed set of in-memory dependency
// doubles. Never connect to Supabase, storage, or a running Next.js server.
const source = fs.readFileSync(new URL("../../src/lib/actions/ospe-stations.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const ID = "2aa55ccd-1b94-4eb7-9e23-0a4a90000001";
const YEAR = "year-1";
type Stored = Record<string, unknown>;
type Result = { id: string } | { error: string };
function harness() {
  const records = new Map<string, Stored>();
  const objects = new Set<string>();
  const events: string[] = [];
  let sequence = 0;
  const hooks: { beforeUpdate?: (id: string) => void } = {};
  const state = { year: YEAR, subjectYear: YEAR, permission: true, classAccess: true,
    authenticated: true, failPut: false, insert: "normal", update: "normal", readError: false, deleted: false };
  const db = {
    auth: { getUser: async () => ({ data: { user: state.authenticated ? { id: "admin-1" } : null } }) },
    rpc: async (name: string, args: Record<string, string>) => {
      if (name === "has_permission") return { data: state.permission, error: null };
      if (name === "admin_can_access_year") return { data: state.classAccess, error: null };
      if (name === "get_ospe_station_for_admin") {
        if (state.readError) return { data: null, error: { message: "unavailable" } };
        const row = records.get(args.p_station_id);
        return row ? { data: row, error: null } : { data: null, error: { message: "ospe_not_found" } };
      }
      if (name === "authorize_study_object_discard") return { data: args.p_object_key, error: null };
      throw Error("Unexpected RPC: " + name);
    },
    from(table: string) {
      if (table === "subjects") return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { year_id: state.subjectYear }, error: null }) }) }) };
      assert.equal(table, "ospe_stations");
      return {
        select: () => ({ eq: (_column: string, id: string) => ({ is: () => ({
          maybeSingle: async () => ({ data: records.has(id) && !state.deleted ? { id } : null, error: null }),
        }) }) }),
        insert: (row: Stored) => ({ select: () => ({ single: async () => {
          const id = String(row.id ?? "single-id");
          events.push("insert:" + id);
          if (state.insert === "reject") return { data: null, error: { code: "23514" } };
          if (records.has(id)) return { data: null, error: { code: "23505" } };
          if (state.insert === "ambiguous-no-commit") return { data: null, error: { code: "FETCH_ERROR" } };
          records.set(id, { ...row, id });
          return state.insert === "ambiguous-commit"
            ? { data: null, error: { code: "FETCH_ERROR" } }
            : { data: { id }, error: null };
        } }) }),
        update: (fields: Stored) => ({ eq: (_column: string, id: string) => {
          events.push("update:" + id);
          hooks.beforeUpdate?.(id);
          const row = records.get(id);
          let result: { data: Stored | null; error: { code: string } | null };
          if (state.update === "reject") result = { data: null, error: { code: "23514" } };
          else if (!row || state.update === "zero-row") result = { data: null, error: null };
          else {
            const updated = { ...row, ...fields, id };
            records.set(id, updated);
            result = state.update === "ambiguous-commit"
              ? { data: null, error: { code: "FETCH_ERROR" } }
              : { data: updated, error: null };
          }
          return Object.assign(Promise.resolve(result), {
            select: () => ({ maybeSingle: async () => result }),
          });
        } }),
      };
    },
  };
  const mocks: Record<string, unknown> = {
    "next/cache": { revalidatePath: () => {} },
    "next/navigation": { redirect: (url: string) => { throw Error("redirect:" + url); } },
    "@/lib/admin/selected-class": { readAdminSelectedYearId: async () => state.year },
    "@/lib/errors/safe-action-error": { actionRpcResult: () => ({ error: "rpc_failed" }), clientActionFailed: () => ({ error: "upload_failed" }), toClientActionError: () => "insert_failed" },
    "@/lib/supabase/server": { createClient: async () => db },
    "@/lib/r2/presign": {
      putR2Object: async ({ key }: { key: string }) => { events.push("put:" + key); objects.add(key); return state.failPut ? { error: "failed" } : {}; },
      deleteR2Object: async ({ key }: { key: string }) => { events.push("delete:" + key); objects.delete(key); },
    },
    "@/lib/study/upload-rules": { isOspeStationImageFile },
    "@/lib/actions/study-content": { allocateStudyObjectKey: async () => { const key = "study-content/test/admin/" + ++sequence; events.push("allocate:" + key); return { key }; } },
    "@/lib/actions/content-bin": {},
    "@/lib/admin/ospe-bulk": { validateOspeBulkItem, matchesOspeBulkReplay },
  };
  const mod = { exports: {} };
  const load = (name: string) => { assert.ok(Object.hasOwn(mocks, name), "Unexpected module: " + name); return mocks[name]; };
  new Function("require", "module", "exports", compiled)(load, mod, mod.exports);
  return { records, objects, events, state, hooks, actions: mod.exports as {
    createOspeStationDraft: (fd: FormData) => Promise<Result>;
    createOspeStation: (fd: FormData) => Promise<Result>;
    updateOspeStation: (id: string, fd: FormData) => Promise<{ error?: string }>;
  } };
}
function form(changes: Record<string, string | File> = {}) {
  const fd = new FormData();
  const values = { requestId: ID, yearId: YEAR, subjectId: "subject-1", title: "Station", answer: "Answer", sortOrder: "0",
    status: "published", image: new File(["test-image"], "test.webp", { type: "image/webp" }), ...changes };
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}
describe("actual OSPE action with isolated storage/database doubles", () => {
  it("saves draft only and replays without another upload", async () => {
    const h = harness();
    assert.deepEqual(await h.actions.createOspeStationDraft(form()), { id: ID });
    assert.equal(h.records.get(ID)?.status, "draft");
    assert.deepEqual(await h.actions.createOspeStationDraft(form()), { id: ID });
    assert.equal(h.records.size, 1);
    assert.equal(h.objects.size, 1);
    assert.equal(h.events.filter(x => x.startsWith("put:")).length, 1);
  });
  it("denies invalid input, stale class, wrong subject, missing permission or unreadable replay before allocation", async () => {
    for (const [state, fields] of [
      [{}, { sortOrder: "NaN" }], [{}, { requestId: "bad" }],
      [{}, { image: new File(["x"], "x.pdf", { type: "application/pdf" }) }],
      [{ year: "other" }, {}], [{ subjectYear: "other" }, {}],
      [{ permission: false }, {}], [{ classAccess: false }, {}],
      [{ authenticated: false }, {}], [{ readError: true }, {}],
    ] as const) {
      const h = harness(); Object.assign(h.state, state);
      assert.ok("error" in await h.actions.createOspeStationDraft(form(fields)));
      assert.deepEqual(h.events, []);
    }
  });
  it("rejects mismatched replay and deleted draft without allocating", async () => {
    const h = harness();
    await h.actions.createOspeStationDraft(form());
    const before = h.events.length;
    assert.ok("error" in await h.actions.createOspeStationDraft(form({ answer: "Other" })));
    h.state.deleted = true;
    assert.ok("error" in await h.actions.createOspeStationDraft(form()));
    assert.equal(h.events.length, before);
  });
  it("retains committed image after response loss and reconciles on retry", async () => {
    const h = harness(); h.state.insert = "ambiguous-commit";
    assert.ok("error" in await h.actions.createOspeStationDraft(form()));
    assert.equal(h.objects.size, 1);
    assert.equal(h.records.size, 1);
    h.state.insert = "normal";
    assert.deepEqual(await h.actions.createOspeStationDraft(form()), { id: ID });
    assert.equal(h.objects.size, 1);
    assert.equal(h.events.filter(x => x.startsWith("put:")).length, 1);
  });
  it("cleans allocated image only for definite rejection or upload failure", async () => {
    for (const state of [{ insert: "reject" }, { failPut: true }]) {
      const h = harness(); Object.assign(h.state, state);
      assert.ok("error" in await h.actions.createOspeStationDraft(form()));
      assert.equal(h.records.size, 0);
      assert.equal(h.objects.size, 0);
      assert.equal(h.events.filter(x => x.startsWith("delete:")).length, 1);
    }
  });
  it("concurrent duplicate requests cannot create two rows or delete winner image", async () => {
    const h = harness();
    const results = await Promise.all([h.actions.createOspeStationDraft(form()), h.actions.createOspeStationDraft(form())]);
    assert.equal(results.filter(x => "id" in x).length, 1);
    assert.equal(h.records.size, 1);
    assert.equal(h.objects.size, 1);
    assert.ok(h.objects.has(String(h.records.get(ID)?.r2_object_key)));
    assert.deepEqual(await h.actions.createOspeStationDraft(form()), { id: ID });
  });
  it("retains the single-create image after response loss", async () => {
    const h = harness(); h.state.insert = "ambiguous-commit";
    assert.ok("error" in await h.actions.createOspeStation(form()));
    assert.equal(h.records.size, 1);
    assert.ok(h.objects.has(String(h.records.get("single-id")?.r2_object_key)));
    assert.equal(h.events.filter(x => x.startsWith("delete:")).length, 0);
  });
  it("cleans single-create allocation on definitive rejection", async () => {
    const h = harness(); h.state.insert = "reject";
    assert.ok("error" in await h.actions.createOspeStation(form()));
    assert.equal(h.records.size, 0);
    assert.equal(h.objects.size, 0);
  });
  it("retains both images after ambiguous committed update", async () => {
    const h = harness();
    await h.actions.createOspeStationDraft(form());
    const oldKey = String(h.records.get(ID)?.r2_object_key);
    h.state.update = "ambiguous-commit";
    assert.ok((await h.actions.updateOspeStation(ID, form())).error);
    const newKey = String(h.records.get(ID)?.r2_object_key);
    assert.notEqual(newKey, oldKey);
    assert.ok(h.objects.has(oldKey));
    assert.ok(h.objects.has(newKey));
  });
  it("does not report success or discard images on zero-row update", async () => {
    const h = harness();
    await h.actions.createOspeStationDraft(form());
    const oldKey = String(h.records.get(ID)?.r2_object_key);
    h.state.update = "zero-row";
    assert.ok((await h.actions.updateOspeStation(ID, form())).error);
    assert.equal(h.records.get(ID)?.r2_object_key, oldKey);
    assert.ok(h.objects.has(oldKey));
    assert.equal(h.objects.size, 2);
  });
  it("cleans definitively rejected replacement", async () => {
    const h = harness();
    await h.actions.createOspeStationDraft(form());
    const oldKey = String(h.records.get(ID)?.r2_object_key);
    h.state.update = "reject";
    assert.ok((await h.actions.updateOspeStation(ID, form())).error);
    assert.deepEqual([...h.objects], [oldKey]);
    assert.equal(h.records.get(ID)?.r2_object_key, oldKey);
  });
  it("removes old image only after matching updated row", async () => {
    const h = harness();
    await h.actions.createOspeStationDraft(form());
    const oldKey = String(h.records.get(ID)?.r2_object_key);
    assert.deepEqual(await h.actions.updateOspeStation(ID, form()), {});
    const newKey = String(h.records.get(ID)?.r2_object_key);
    assert.notEqual(oldKey, newKey);
    assert.deepEqual([...h.objects], [newKey]);
  });
  it("metadata-only edit cannot restore an obsolete image after concurrent replacement", async () => {
    const h = harness();
    await h.actions.createOspeStationDraft(form());
    const oldKey = String(h.records.get(ID)?.r2_object_key);
    const currentKey = "study-content/test/admin/concurrent-replacement";
    h.hooks.beforeUpdate = (id) => {
      // Interleave another committed replacement after this edit loaded
      // its snapshot, before the metadata update reaches the database.
      h.hooks.beforeUpdate = undefined;
      h.records.set(id, { ...h.records.get(id), r2_object_key: currentKey,
        r2_content_type: "image/png", r2_byte_size: 42 });
      h.objects.add(currentKey);
      h.objects.delete(oldKey);
    };
    const fd = form({ title: "Metadata edited" });
    fd.delete("image");
    assert.deepEqual(await h.actions.updateOspeStation(ID, fd), {});
    assert.equal(h.records.get(ID)?.title, "Metadata edited");
    assert.equal(h.records.get(ID)?.r2_object_key, currentKey);
    assert.equal(h.records.get(ID)?.r2_content_type, "image/png");
    assert.equal(h.records.get(ID)?.r2_byte_size, 42);
    assert.deepEqual([...h.objects], [currentKey]);
  });
  it("preserves original single create redirect and rejects cross-year replacement", async () => {
    const h = harness();
    await assert.rejects(h.actions.createOspeStation(form()), /redirect:\/admin\/ospe-stations\/single-id/);
    assert.equal(h.records.get("single-id")?.status, "published");
    const before = h.events.length;
    h.state.subjectYear = "other";
    assert.ok("error" in await h.actions.updateOspeStation("single-id", form()));
    assert.equal(h.events.length, before);
  });
});
