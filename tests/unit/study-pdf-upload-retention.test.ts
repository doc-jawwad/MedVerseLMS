import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import ts from "typescript";
import { isStudyCoverFile, isStudyPdfMeta, STUDY_PDF_CONTENT_TYPE } from "../../src/lib/study/upload-rules.ts";

const compiled = ts.transpileModule(fs.readFileSync(new URL("../../src/lib/actions/study-pdf-upload.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
type Row = Record<string, unknown>;
const PDF = "study-content/test/admin/pdf";
const COVER = "study-content/test/admin/cover";
function harness(mode: "put" | "multipart" = "put") {
  const objects = new Set([PDF]);
  const rows: Row[] = [];
  const events: string[] = [];
  const state = { uid: "admin", role: "admin", folder: true, insert: "normal", head: "normal", cover: "normal", complete: "normal", sign: "normal", seal: "normal", multipart: "normal", revalidate: "normal" };
  const session = { v: 1, key: PDF, uploadId: mode === "multipart" ? "upload" : null, folderId: "folder", mode, declaredSize: 8, contentType: "application/pdf", uid: "admin", partSize: 4, partCount: mode === "multipart" ? 2 : 1, exp: 9999999999 };
  let allocation = 0;
  const db = {
    auth: { getUser: async () => ({ data: { user: state.uid ? { id: state.uid } : null } }) },
    rpc: async (name: string) => {
      if (name === "allocate_study_object_key") return { data: ++allocation === 1 ? COVER : PDF, error: null };
      if (name === "authorize_study_object_discard") return { error: null };
      throw Error("Unexpected RPC: " + name);
    },
    from: (table: string) => {
      if (table === "profiles") return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: state.role } }) }) }) };
      if (table === "material_folders") return { select: () => ({ eq: () => ({ is: () => ({ maybeSingle: async () => ({ data: state.folder ? { id: "folder" } : null, error: null }) }) }) }) };
      assert.equal(table, "materials");
      return { insert: async (row: Row) => {
        events.push("insert");
        if (state.insert === "reject") return { error: { code: "23514" } };
        rows.push(row);
        if (state.insert === "throw") throw Error("response lost");
        return { error: state.insert === "ambiguous" ? { code: "FETCH_ERROR" } : null };
      } };
    },
  };
  const mocks: Record<string, unknown> = {
    "next/cache": { revalidatePath: () => { if (state.revalidate === "throw") throw Error("refresh failed"); } },
    "@/lib/errors/safe-action-error": { actionRpcResult: () => ({ error: "rpc_failed" }), clientActionFailed: () => ({ error: "upload_failed" }), toClientActionError: () => "insert_failed" },
    "@/lib/supabase/server": { createClient: async () => db },
    "@/lib/r2/presign": {
      deleteR2Object: async ({ key }: { key: string }) => { events.push("delete:" + key); objects.delete(key); },
      putR2Object: async ({ key }: { key: string }) => { events.push("put:" + key); objects.add(key); return state.cover === "fail" ? { error: "lost" } : {}; },
    },
    "@/lib/r2/multipart": {
      abortMultipartUpload: async () => { events.push("abort-multipart"); return {}; },
      completeMultipartUpload: async () => { events.push("complete-multipart"); return state.complete === "fail" ? { error: "lost" } : {}; },
      headR2Object: async () => state.head === "fail" ? { error: "head_failed" } : { contentLength: 8, contentType: "application/pdf" },
      getR2ObjectRange: async () => ({ body: Buffer.from("%PDF-1.7") }),
      presignR2Upload: () => state.sign === "fail" ? { error: "sign_failed" } : { url: "https://fixture.invalid" },
      createMultipartUpload: async () => state.multipart === "fail" ? { error: "lost" } : { uploadId: "upload" },
    },
    "@/lib/study/upload-session": {
      chooseStudyPdfParting: () => ({ mode, partSize: 4, partCount: 2 }),
      openStudyPdfUploadSession: () => session,
      sealStudyPdfUploadSession: () => state.seal === "fail" ? { error: "seal_failed" } : { token: "fixture" },
      STUDY_PDF_UPLOAD_SESSION_TTL_SECONDS: 3600,
    },
    "@/lib/study/upload-rules": { isStudyCoverFile, isStudyPdfMeta, STUDY_PDF_CONTENT_TYPE },
    "@/lib/library/types": { STUDY_REVALIDATE_PATHS: ["/fixture"] },
  };
  const mod = { exports: {} };
  new Function("require", "module", "exports", compiled)((name: string) => {
    assert.ok(Object.hasOwn(mocks, name), "Unexpected module: " + name);
    return mocks[name];
  }, mod, mod.exports);
  const actions = mod.exports as {
    beginStudyPdfUpload: (input: { folderId: string; fileName: string; byteSize: number; contentType: string }) => Promise<{error?: string}>;
    completeStudyPdfUpload: (input: { sessionToken: string; title: string; cover?: File; parts?: Array<{partNumber: number; etag: string}> }) => Promise<{error?: string; ok?: boolean}>;
    abortStudyPdfUpload: (input: { sessionToken: string }) => Promise<{error?: string; ok?: boolean}>;
  };
  return { actions, objects, rows, events, state };
}
const input = { sessionToken: "fixture", title: "Fixture PDF", parts: [{partNumber: 1, etag: '"one"'}, {partNumber: 2, etag: '"two"'}] };
const cover = () => new File(["test-image"], "cover.webp", { type: "image/webp" });
describe("PDF upload preservation: actual actions with closed-set mocks", () => {
  it("retains committed PDF and cover after lost insert response", async () => {
    const h = harness(); h.state.insert = "ambiguous";
    assert.ok((await h.actions.completeStudyPdfUpload({...input, cover: cover()})).error);
    assert.equal(h.rows.length, 1);
    assert.ok(h.objects.has(PDF)); assert.ok(h.objects.has(COVER));
    await h.actions.abortStudyPdfUpload(input);
    assert.ok(h.objects.has(PDF)); assert.ok(h.objects.has(COVER));
  });
  it("retains committed PDF after thrown insert or revalidation exception", async () => {
    for (const state of [{insert:"throw"}, {revalidate:"throw"}]) {
      const h = harness(); Object.assign(h.state,state);
      assert.ok((await h.actions.completeStudyPdfUpload(input)).error);
      assert.equal(h.rows.length, 1); assert.ok(h.objects.has(PDF));
    }
  });
  it("late cancel never deletes a successfully saved PDF", async () => {
    const h = harness();
    assert.equal((await h.actions.completeStudyPdfUpload(input)).ok,true);
    await h.actions.abortStudyPdfUpload(input);
    assert.ok(h.objects.has(PDF)); assert.equal(h.rows.length,1);
  });
  it("multipart abort touches only the multipart upload, never its final key", async () => {
    const h = harness("multipart");
    assert.equal((await h.actions.completeStudyPdfUpload(input)).ok,true);
    await h.actions.abortStudyPdfUpload(input);
    assert.ok(h.objects.has(PDF)); assert.ok(h.events.includes("abort-multipart"));
    assert.ok(!h.events.some(x=>x.startsWith("delete:")));
  });
  it("verification, cover and explicit insert errors retain candidates for later reconciliation", async () => {
    for (const state of [{head:"fail"}, {cover:"fail"}, {insert:"reject"}]) {
      const h = harness(); Object.assign(h.state,state);
      assert.ok((await h.actions.completeStudyPdfUpload({...input,cover:cover()})).error);
      assert.ok(h.objects.has(PDF)); assert.ok(!h.events.some(x=>x.startsWith("delete:")));
    }
  });
  it("failed multipart completion plus cancellation preserves the final key", async () => {
    const h = harness("multipart"); h.state.complete = "fail";
    assert.ok((await h.actions.completeStudyPdfUpload(input)).error);
    await h.actions.abortStudyPdfUpload(input);
    assert.ok(h.objects.has(PDF)); assert.ok(h.events.includes("abort-multipart"));
  });
  it("wrong owner cannot abort or complete", async () => {
    const h = harness("multipart"); h.state.uid = "other";
    assert.ok((await h.actions.abortStudyPdfUpload(input)).error);
    assert.ok((await h.actions.completeStudyPdfUpload(input)).error);
    assert.deepEqual(h.events,[]); assert.ok(h.objects.has(PDF));
  });
  it("begin failures do not discard a possibly existing allocation", async () => {
    for (const [mode, state] of [["put",{sign:"fail"}],["put",{seal:"fail"}],["multipart",{multipart:"fail"}],["multipart",{seal:"fail"}]] as const) {
      const h = harness(mode); Object.assign(h.state,state); h.objects.add(COVER);
      assert.ok((await h.actions.beginStudyPdfUpload({folderId:"folder",fileName:"file.pdf",byteSize:8,contentType:"application/pdf"})).error);
      assert.ok(h.objects.has(COVER)); assert.ok(!h.events.some(x=>x.startsWith("delete:")));
    }
  });
});
