import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import ts from "typescript";
import { createHash } from "node:crypto";
import * as geometry from "../../src/lib/study/pdf-ink-geometry.ts";

function load(path: string, mocks: Record<string, unknown>) {
  const source = fs.readFileSync(new URL("../../" + path, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  new Function("require","module","exports",code)((name: string) => {
    assert.ok(Object.hasOwn(mocks,name),"Unexpected module: "+name);
    return mocks[name];
  },mod,mod.exports);
  return mod.exports;
}
const revision = createHash("md5").update("study-content/qa/immutable.pdf").digest("hex");
const row = { id:"ink-1", student_id:"owner", material_id:"doc", content_revision:revision,
  page_number:1, points:[[12,34],[56,78]],color:"#dc2626",width:2 };
type Stroke = { id:string; ownerId:string; materialId:string; revision:string; page:number;
  points:geometry.PdfInkPoint[];color:geometry.PdfInkColor;width:number };
const stroke: Stroke={id:"ink-1",ownerId:"owner",materialId:"doc",revision,page:1,points:[[12,34],[56,78]],color:"#dc2626",width:2};
function inkHarness() {
  const state={ revision:revision as string|null, actor:"owner", insertError:false, prior:row as unknown,
    deleteRows:[{id:"ink-1"}], listRows:[row] as unknown[], switchBeforeSave:false, savedOwners:[] as string[] };
  const events:string[]=[];
  const chain = {
    eq(k:string,v:unknown){events.push("eq:"+k+"="+v);return this;},
    order(){return this;},
    limit(n:number){events.push("limit:"+n);return Promise.resolve({data:state.listRows,error:null});},
    select(){return this;},
    maybeSingle:async()=>({data:state.prior,error:null}),
    then(resolve:(v:unknown)=>unknown){return Promise.resolve({data:state.deleteRows,error:null}).then(resolve);},
  };
  const client={rpc:async(name:string,payload:Record<string,unknown>)=>{
    if(name==="pdf_ink_revision")return {data:state.revision,error:null};
    assert.equal(name,"save_pdf_ink_stroke");
    assert.equal(payload.p_expected_owner,stroke.ownerId);
    assert.equal(payload.p_id,stroke.id);
    assert.deepEqual(payload.p_points,stroke.points);
    events.push("save");
    if(state.switchBeforeSave)state.actor="peer";
    if(state.actor!==payload.p_expected_owner)return {data:null,error:{message:"pdf_ink_actor_mismatch"}};
    if(!state.insertError)state.savedOwners.push(state.actor);
    return {data:state.insertError?null:row,error:state.insertError?{message:"lost"}:null};
  },auth:{getUser:async()=>({data:{user:{id:state.actor}},error:null})},
    from:(name:string)=>{assert.equal(name,"pdf_ink_strokes");return {
      select:()=>chain,
      delete:()=>{events.push("delete");return chain;},
    }}};
  const api=load("src/lib/study/pdf-ink.ts",{"@/lib/supabase/client":{createClient:()=>client},"@/lib/study/pdf-ink-geometry":geometry}) as {
    saveInkStroke(s:Stroke):Promise<Stroke>; removeInkStroke(s:Stroke):Promise<void>;
    listInkPage(m:string,r:string,p:number,o:string):Promise<{rows:Stroke[];full:boolean}>;
  };
  return {api,state,events};
}
describe("actual private ink client with closed-set database doubles",()=>{
  it("saves exact owner stroke and reconciles response loss only on exact match",async()=>{
    const h=inkHarness();
    assert.deepEqual(await h.api.saveInkStroke(stroke),stroke);
    h.state.insertError=true;
    assert.deepEqual(await h.api.saveInkStroke(stroke),stroke);
    h.state.prior={...row,student_id:"peer"};
    await assert.rejects(h.api.saveInkStroke(stroke),/not confirmed/);
    h.state.prior={...row,points:[[1,2]]};
    await assert.rejects(h.api.saveInkStroke(stroke),/not confirmed/);
  });
  it("rejects changed revision and changed actor before mutation",async()=>{
    const h=inkHarness();h.state.revision=null;
    await assert.rejects(h.api.saveInkStroke(stroke),/access unavailable/);
    await assert.rejects(h.api.removeInkStroke(stroke),/access unavailable/);
    h.state.revision=revision;h.state.actor="peer";
    await assert.rejects(h.api.saveInkStroke(stroke),/Account changed/);
    await assert.rejects(h.api.removeInkStroke(stroke),/Account changed/);
    assert.deepEqual(h.events,[]);
  });
  it("binds the expected actor even if the account changes after getUser",async()=>{
    const h=inkHarness();
    h.state.switchBeforeSave=true;
    h.state.prior=null;
    await assert.rejects(h.api.saveInkStroke(stroke),/not confirmed/);
    assert.deepEqual(h.state.savedOwners,[]);
    assert.ok(h.events.includes("save"));
  });
  it("requires one confirmed deleted row and scopes requests",async()=>{
    const h=inkHarness();await h.api.removeInkStroke(stroke);
    assert.ok(h.events.includes("eq:student_id=owner"));
    h.state.deleteRows=[];
    await assert.rejects(h.api.removeInkStroke(stroke),/removal not confirmed/);
  });
  it("loads only one bounded owner/material/revision/page window",async()=>{
    const h=inkHarness();h.state.listRows=Array.from({length:201},(_,i)=>({...row,id:"stroke-"+i}));
    const result=await h.api.listInkPage("doc",revision,1,"owner");
    assert.equal(result.rows.length,200);assert.equal(result.full,true);
    for(const event of ["eq:student_id=owner","eq:material_id=doc","eq:content_revision="+revision,"eq:page_number=1","limit:201"])assert.ok(h.events.includes(event));
    h.state.listRows=[{...row,points:[[1,"invalid"]]}];
    await assert.rejects(h.api.listInkPage("doc",revision,1,"owner"),/Invalid saved stroke/);
  });
});

describe("protected PDF revision pinning",()=>{
  it("authorizes HEAD and every GET before streaming, rejects changed revision before upstream fetch",async()=>{
    let key:string|null="study-content/qa/immutable.pdf";let headCalls=0,getCalls=0;
    class MockNextResponse extends Response {
      static json(value:unknown, init?:ResponseInit){return new Response(JSON.stringify(value),init);}
    }
    const api=load("src/app/api/study-content/[materialId]/route.ts",{
      "next/server":{NextResponse:MockNextResponse},"node:crypto":{createHash},
      "@/lib/supabase/server":{createClient:async()=>({rpc:async()=>({data:key,error:null})})},
      "@/lib/r2/presign":{
        headR2ObjectViaPresign:async()=>{headCalls++;return {contentLength:100};},
        fetchR2ObjectStream:async()=>{getCalls++;return {status:206,headers:new Headers({"Content-Length":"4"}),body:new Uint8Array([1,2,3,4])};},
      },
    }) as {HEAD(r:Request,c:unknown):Promise<Response>;GET(r:Request,c:unknown):Promise<Response>};
    const ctx={params:Promise.resolve({materialId:"doc"})};
    const url="https://example.test/api/study-content/doc";
    const h=await api.HEAD(new Request(url,{method:"HEAD"}),ctx);
    assert.equal(h.status,200);assert.equal(h.headers.get("x-pdf-revision"),revision);assert.equal(headCalls,1);
    const get=()=>api.GET(new Request(url,{headers:{Range:"bytes=0-3","X-Pdf-Revision":revision}}),ctx);
    assert.equal((await get()).headers.get("x-pdf-revision"),revision);assert.equal(getCalls,1);
    key="study-content/qa/replacement.pdf";
    assert.equal((await get()).status,409);assert.equal(getCalls,1);
    // Older readers remain compatible, never bypass authorization.
    assert.equal((await api.GET(new Request(url,{headers:{Range:"bytes=0-3"}}),ctx)).status,206);
    key=null;assert.equal((await get()).status,403);
    assert.equal((await api.HEAD(new Request(url,{method:"HEAD"}),ctx)).status,403);
    assert.equal(getCalls,2);assert.equal(headCalls,1);
  });
});
