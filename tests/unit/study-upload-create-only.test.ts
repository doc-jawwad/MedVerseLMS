import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import ts from "typescript";
import { createHash, createHmac } from "node:crypto";

const config = {accountId:"fixture", accessKeyId:"fixture-key", secretAccessKey:"fixture-secret", bucket:"test", endpoint:"https://fixture.invalid", region:"auto"};
const key = "study-content/fixture/new.pdf";
function load(fetcher: typeof fetch) {
  const source=fs.readFileSync(new URL("../../src/lib/r2/multipart.ts",import.meta.url),"utf8");
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const mod={exports:{}};
  new Function("require","module","exports","fetch",code)((name:string)=>{
    if(name==="server-only")return {};
    if(name==="node:crypto")return {createHash,createHmac};
    assert.equal(name,"@/lib/r2/presign");
    return {getR2Config:()=>config,isAllowedR2ObjectKey:(k:string)=>k===key};
  },mod,mod.exports,fetcher);
  return mod.exports as {
    presignR2Upload(o:Record<string,unknown>):{url:string}|{error:string};
    completeMultipartUpload(o:Record<string,unknown>):Promise<{error?:string}>;
  };
}
function hmac(k:string|Buffer,s:string){return createHmac("sha256",k).update(s).digest();}
function hash(s:string){return createHash("sha256").update(s).digest("hex");}
const denyFetch:typeof fetch=async()=>{throw Error("Unexpected network");};
describe("create-only PDF upload signing",()=>{
  it("signs exact wildcard for a single PUT, not UploadPart",()=>{
    const api=load(denyFetch);
    const opts={method:"PUT",key,config,now:new Date("2026-11-26T00:00:00Z"),contentType:"application/pdf"};
    const result=api.presignR2Upload({...opts,createOnly:true});
    assert.ok("url" in result);
    const u=new URL(result.url);
    const names="content-type;host;if-none-match";
    assert.equal(u.searchParams.get("X-Amz-SignedHeaders"),names);
    const query=u.search.slice(1).split("&").filter(v=>!v.startsWith("X-Amz-Signature=")).join("&");
    const scope="20261126/auto/s3/aws4_request";
    const signing=hmac(hmac(hmac(hmac("AWS4"+config.secretAccessKey,"20261126"),"auto"),"s3"),"aws4_request");
    const sig=(value:string)=>hmac(signing,["AWS4-HMAC-SHA256","20261126T000000Z",scope,hash(["PUT",u.pathname,query,"content-type:application/pdf\nhost:fixture.invalid\nif-none-match:"+value+"\n",names,"UNSIGNED-PAYLOAD"].join("\n"))].join("\n")).toString("hex");
    assert.equal(u.searchParams.get("X-Amz-Signature"),sig("*"));
    assert.notEqual(u.searchParams.get("X-Amz-Signature"),sig('"other"'));
    const part=api.presignR2Upload({...opts,contentType:undefined,query:{partNumber:"1",uploadId:"fixture"}});
    assert.ok("url" in part);
    assert.equal(new URL(part.url).searchParams.get("X-Amz-SignedHeaders"),"host");
    assert.deepEqual(api.presignR2Upload({...opts,createOnly:true,query:{partNumber:"1",uploadId:"fixture"}}),{error:"invalid_create_only_query"});
  });
  it("signs final multipart completion and propagates precondition failure",async()=>{
    let calls=0;
    const api=load(async(input,init)=>{
      calls++;
      assert.equal(new URL(String(input)).searchParams.get("uploadId"),"fixture");
      assert.equal(init?.method,"POST");
      const headers=new Headers(init?.headers);
      assert.equal(headers.get("if-none-match"),"*");
      assert.match(headers.get("authorization")??"",/SignedHeaders=content-type;host;if-none-match;x-amz-content-sha256;x-amz-date,/);
      return new Response("PreconditionFailed",{status:412});
    });
    const result=await api.completeMultipartUpload({key,uploadId:"fixture",parts:[{partNumber:1,etag:'"fixture"'}],config});
    assert.match(result.error??"",/r2_multipart_complete_failed:412:/);
    assert.equal(calls,1);
  });
  it("requires the header at the browser and keeps CORS origins scoped",()=>{
    const read=(p:string)=>fs.readFileSync(new URL("../../"+p,import.meta.url),"utf8");
    assert.match(read("src/lib/actions/study-pdf-upload.ts"),/contentType: STUDY_PDF_CONTENT_TYPE,\s*createOnly: true/);
    const uploader=read("src/components/admin/study-pdf-uploader.tsx");
    assert.match(uploader,/if \(createOnly\) xhr\.setRequestHeader\("If-None-Match", "\*"\)/);
    assert.match(uploader,/began\.putUrl,[\s\S]*?abort\.signal,\s*true\s*\)/);
    const cors=read("src/lib/r2/cors-policy.ts");
    assert.match(cors,/"If-None-Match"/);
    assert.doesNotMatch(cors,/AllowedOrigins:\s*\[\s*"\*"/);
  });
});
