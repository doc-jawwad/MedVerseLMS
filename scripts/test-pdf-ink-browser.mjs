// Local-only component acceptance: real React, PDF.js viewport and browser events.
// No Supabase, R2, staging, production, or external network. Run with node.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { chromium } from "playwright";
import ts from "typescript";
const require = createRequire(import.meta.url);
const root = new URL("../", import.meta.url);
const source = p => fs.readFileSync(new URL(p, root), "utf8");
const modules = {};
for (const [id,pkg,file] of [
  ["react","react","react.production.js"],["react/jsx-runtime","react","react-jsx-runtime.production.js"],
  ["react-dom","react-dom","react-dom.production.js"],["react-dom/client","react-dom","react-dom-client.production.js"],
  ["scheduler","scheduler","scheduler.production.js"]
]) modules[id]=fs.readFileSync(join(dirname(require.resolve(pkg)), "cjs", file),"utf8");
for (const [id,file] of [
  ["@/lib/study/pdf-ink-geometry","src/lib/study/pdf-ink-geometry.ts"],
  ["@/lib/study/pdf-ink","src/lib/study/pdf-ink.ts"],
  ["./use-pdf-ink","src/components/study/use-pdf-ink.ts"],
  ["./pdf-ink-layer","src/components/study/pdf-ink-layer.tsx"],
  ["./pdf-ink-toolbar","src/components/study/pdf-ink-toolbar.tsx"]
]) modules[id]=ts.transpileModule(source(file),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
modules["@/components/ui/button"]='const R=require("react"); exports.Button=({variant,size,...p})=>R.createElement("button",p)';
modules["@/lib/supabase/client"]=`
let actor="owner"; const listeners=new Set();
window.switchActor=id=>{actor=id;for(const f of listeners)f("SIGNED_IN",id?{user:{id}}:null)};
const client={auth:{getUser:async()=>({data:{user:actor?{id:actor}:null}}),onAuthStateChange:f=>{listeners.add(f);queueMicrotask(()=>f("INITIAL_SESSION",actor?{user:{id:actor}}:null));return {data:{subscription:{unsubscribe:()=>listeners.delete(f)}}}}},
rpc:async(name,p)=>window.db({op:name,p,actor}),
from:()=>{let op="list",filters={};const run=()=>window.db({op,filters,actor});const q={select:()=>q,eq:(k,v)=>{filters[k]=v;return q},order:()=>q,limit:run,maybeSingle:()=>{op="one";return run()},delete:()=>{op="delete";return q},then:(a,b)=>run().then(a,b)};return q}};
exports.createClient=()=>client;`;
const loader=`const sources=${JSON.stringify(modules)};const cache={};function require(id){if(cache[id])return cache[id].exports;if(!Object.hasOwn(sources,id))throw Error("Unknown module "+id);const m={exports:{}};cache[id]=m;new Function("require","module","exports",sources[id])(require,m,m.exports);return m.exports;}window.localRequire=require;`;
const pdfjs=fs.readFileSync(require.resolve("pdfjs-dist/build/pdf.mjs"));
const worker=fs.readFileSync(require.resolve("pdfjs-dist/build/pdf.worker.mjs"));
// Small deterministic PDF with actual text.
const bodies=["1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n","2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n","3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 500] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents 4 0 R >>endobj\n"];
const stream="BT /F1 18 Tf 40 450 Td (Synthetic PDF text) Tj ET";
bodies.push("4 0 obj<< /Length "+stream.length+" >>stream\n"+stream+"\nendstream\nendobj\n");
let pdf="%PDF-1.4\n",offsets=[0];for(const b of bodies){offsets.push(pdf.length);pdf+=b;}const xref=pdf.length;
pdf+="xref\n0 5\n0000000000 65535 f \n"+offsets.slice(1).map(x=>String(x).padStart(10,"0")+" 00000 n \n").join("")+"trailer<< /Size 5 /Root 1 0 R >>\nstartxref\n"+xref+"\n%%EOF\n";
const html=`<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:8px}button,select{margin:3px}.stage{position:relative;background:#fff}.stage svg{position:absolute;inset:0;width:100%;height:100%}canvas{position:absolute;inset:0}.textLayer{position:absolute;inset:0;overflow:hidden;line-height:1}.textLayer span{position:absolute;white-space:pre;transform-origin:0 0;color:transparent;cursor:text}</style><div id="root"></div><script src="/bundle.js"></script><script type="module">
import * as pdfjs from "/pdf.mjs";
pdfjs.GlobalWorkerOptions.workerSrc="/worker.mjs";
const R=localRequire("react"),h=R.createElement, {createRoot}=localRequire("react-dom/client");
const {usePdfInk}=localRequire("./use-pdf-ink"),{PdfInkLayer}=localRequire("./pdf-ink-layer"),{PdfInkToolbar}=localRequire("./pdf-ink-toolbar");
const doc=await pdfjs.getDocument({url:"/fixture.pdf"}).promise, pdfPage=await doc.getPage(1);
function App(){const [scale,S]=R.useState(.7),[rotation,T]=R.useState(0),[opened,O]=R.useState(true);return h("div",null,h("button",{id:"zoom",onClick:()=>S(s=>s+.15)},"Zoom"),h("button",{id:"rotate",onClick:()=>T(r=>(r+90)%360)},"Rotate"),h("button",{id:"reopen",onClick:()=>O(o=>!o)},"Toggle reader"),opened&&h(Reader,{scale,rotation}));}
function Reader({scale,rotation}){const v=R.useMemo(()=>pdfPage.getViewport({scale,rotation}),[scale,rotation]);const ink=usePdfInk("doc","a".repeat(32),1,true);const canvas=R.useRef(null),text=R.useRef(null);R.useEffect(()=>{const c=canvas.current;c.width=v.width;c.height=v.height;const task=pdfPage.render({canvasContext:c.getContext("2d"),viewport:v});task.promise.catch(()=>{});const el=text.current;el.replaceChildren();el.style.setProperty("--scale-factor",String(scale));const layer=new pdfjs.TextLayer({textContentSource:pdfPage.streamTextContent(),container:el,viewport:v});layer.render().catch(()=>{});return()=>{task.cancel();layer.cancel()}},[v,scale]);return h("div",null,h(PdfInkToolbar,{ink,page:1,onMode:ink.setMode,onClose:()=>ink.setMode("read")}),h("div",{className:"stage",style:{width:v.width,height:v.height}},h("canvas",{ref:canvas}),h("div",{className:"textLayer",ref:text}),h(PdfInkLayer,{ink,viewport:v})))}
createRoot(document.getElementById("root")).render(h(App));
</script>`;
const routes={"/":[html,"text/html"],"/bundle.js":[loader,"text/javascript"],"/pdf.mjs":[pdfjs,"text/javascript"],"/worker.mjs":[worker,"text/javascript"],"/fixture.pdf":[pdf,"application/pdf"]};
const server=http.createServer((req,res)=>{const r=routes[req.url];if(!r){res.writeHead(404).end();return}res.writeHead(200,{"Content-Type":r[1],"Cache-Control":"no-store"}).end(r[0]);});
await new Promise(r=>server.listen(0,"127.0.0.1",r));const origin="http://127.0.0.1:"+server.address().port;
const rows=new Map();let lose=false, saveCount=0;
function db({op,p,filters={},actor}){
  if(op==="pdf_ink_revision")return {data:"a".repeat(32)};
  if(op==="save_pdf_ink_stroke"){saveCount++;if(actor!==p.p_expected_owner)return {error:"actor mismatch"};if(rows.has(p.p_id))return {error:"duplicate"};const r={id:p.p_id,student_id:actor,material_id:p.p_material_id,content_revision:p.p_content_revision,page_number:p.p_page_number,points:p.p_points,color:p.p_color,width:p.p_width};if(lose){lose=false;return {error:"not stored"}}rows.set(r.id,r);return {data:r};}
  const result=[...rows.values()].filter(r=>r.student_id===actor&&Object.entries(filters).every(([k,v])=>r[k]===v));
  if(op==="delete"){for(const r of result)rows.delete(r.id);return {data:result.map(r=>({id:r.id}))};}
  return {data:op==="one"?result[0]??null:result};
}
let browser;
try {
  browser=await chromium.launch({channel:"chrome",headless:true,args:["--disable-background-networking","--disable-component-update"]});
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,serviceWorkers:"block"});
  await context.route("**/*",r=>r.request().url().startsWith(origin+"/")?r.continue():r.abort());
  const page=await context.newPage();page.setDefaultTimeout(12000);page.on("pageerror",e=>console.log("PAGE_ERROR",e.message));
  await page.exposeFunction("db",db);await page.goto(origin);
  const pen=page.getByTestId("pdf-ink-pen"),layer=page.getByTestId("pdf-ink-layer"),status=page.getByTestId("pdf-ink-status"),strokes=layer.locator("[data-ink-id]");
  async function until(f){for(let i=0;i<100;i++){if(await f())return;await new Promise(r=>setTimeout(r,100))}throw Error("condition timed out")}
  await pen.waitFor();await until(()=>pen.isEnabled());await until(async()=> (await page.locator(".textLayer span").count())>0);
  await pen.click();await until(async()=>await layer.getAttribute("data-ink-mode")==="pen");
  const draw=async()=>{const b=await layer.boundingBox();await page.mouse.move(b.x+40,b.y+80);await page.mouse.down();await page.mouse.move(b.x+90,b.y+100,{steps:8});await page.mouse.up()};
  await draw();await until(()=>rows.size===1);await until(async()=> (await status.textContent()).includes("Drawing saved"));assert.equal(await strokes.count(),1);
  const saved=[...rows.values()][0];const before=await strokes.first().getAttribute("points");
  await page.locator("#zoom").click();await until(async()=>await strokes.first().getAttribute("points")!==before);
  const zoomed=await strokes.first().getAttribute("points");await page.locator("#rotate").click();await until(async()=>await strokes.first().getAttribute("points")!==zoomed);assert.deepEqual([...rows.values()][0],saved);
  console.log("PASS mouse draw + PDF.js zoom/rotation preserves saved PDF points");
  await page.reload();await until(()=>pen.isEnabled());await until(async()=>await strokes.count()===1);
  await page.getByRole("button",{name:"Read",exact:true}).click();assert.equal(await layer.evaluate(el=>getComputedStyle(el).pointerEvents),"none");
  console.log("PASS reopen persisted drawing + read mode passes pointer events");
  await page.getByTestId("pdf-ink-eraser").click();await until(async()=>await layer.getAttribute("data-ink-mode")==="erase");
  const xy=await strokes.first().evaluate(el=>{const p=el.points.getItem(0),q=new DOMPoint(p.x,p.y).matrixTransform(el.getScreenCTM());return {x:q.x,y:q.y}});
  await page.mouse.click(xy.x,xy.y);await until(()=>rows.size===0);await until(async()=>await strokes.count()===0);console.log("PASS erase saved drawing");
  await pen.click();lose=true;await draw();await page.getByRole("button",{name:"Retry save"}).waitFor();assert.equal(rows.size,0);
  await page.getByRole("button",{name:"Retry save"}).click();await until(()=>rows.size===1);await until(async()=> (await status.textContent()).includes("Drawing saved"));assert.equal(rows.size,1);
  await page.getByTestId("pdf-ink-undo").click();await until(()=>rows.size===0);await until(async()=>await strokes.count()===0);console.log("PASS failed save retry + undo");
  await pen.click();await until(async()=>await layer.getAttribute("data-ink-mode")==="pen");const b=await layer.boundingBox();const cdp=await context.newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:b.x+40,y:b.y+80}]});
  await cdp.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:b.x+85,y:b.y+105}]});
  await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
  await until(()=>rows.size===1);await until(async()=> (await status.textContent()).includes("Drawing saved"));console.log("PASS mobile touch drawing");
  await page.evaluate(()=>window.switchActor("peer"));await until(async()=>await strokes.count()===0);assert.equal(rows.size,1);
  await context.setOffline(true);await until(async()=>!(await pen.isEnabled()));assert.match(await status.textContent(),/requires the online PDF/);assert.equal(await layer.evaluate(el=>getComputedStyle(el).pointerEvents),"none");console.log("PASS account switch hides strokes; offline disables editing");
  assert.equal(saveCount,4); console.log("BROWSER_COMPONENT_ACCEPTANCE_PASS");
}finally{await browser?.close();await new Promise(r=>server.close(r));}
