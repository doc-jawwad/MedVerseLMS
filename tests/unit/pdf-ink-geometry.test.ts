import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { appendInkPoint, clientToInkPoint, inkStrokeHit, inkViewportPoints, parsePdfInkPoints,
  PDF_INK_MAX_POINTS, type PdfInkPoint } from "../../src/lib/study/pdf-ink-geometry.ts";

function viewport(scale: number, rotation: 0 | 90 | 180 | 270) {
  // An offset PDF crop box with exact affine transforms for each quarter turn.
  const w = 600, h = 800, x0 = 20, y0 = 30;
  const size = rotation % 180 ? [h, w] : [w, h];
  return {
    width: size[0] * scale, height: size[1] * scale,
    convertToViewportPoint(x: number, y: number) {
      x -= x0; y -= y0;
      const p = rotation === 0 ? [x, h-y] : rotation === 90 ? [y,x] : rotation === 180 ? [w-x,y] : [h-y,w-x];
      return p.map(n => n*scale);
    },
    convertToPdfPoint(x: number,y: number) {
      x /= scale; y /= scale;
      const p = rotation === 0 ? [x,h-y] : rotation === 90 ? [y,x] : rotation === 180 ? [w-x,y] : [w-y,h-x];
      return [p[0]+x0,p[1]+y0];
    },
  };
}
describe("PDF freehand pen geometry", () => {
  it("round-trips page-space points at four rotations and three zoom levels", () => {
    const point: PdfInkPoint = [137.25, 389.625];
    for (const scale of [0.5,1,2.25]) for (const rotation of [0,90,180,270] as const) {
      const v = viewport(scale,rotation);
      const box = {left:19,top:-240,width:v.width*0.85,height:v.height*0.85};
      const [x,y] = v.convertToViewportPoint(...point);
      assert.deepEqual(clientToInkPoint(v,box,box.left+x*0.85,box.top+y*0.85),point);
      assert.deepEqual(inkViewportPoints(v,[point]),[[x,y]]);
    }
  });
  it("clips captured pointers at page edges and rejects unpainted boxes", () => {
    const v=viewport(1,0);
    const box={left:10,top:20,width:600,height:800};
    assert.deepEqual(clientToInkPoint(v,box,-100,9999),[20,30]);
    assert.equal(clientToInkPoint(v,{...box,width:0},0,0),null);
    assert.equal(clientToInkPoint(v,box,NaN,0),null);
  });
  it("keeps single-point dots and rejects malformed or oversized entire strokes", () => {
    assert.deepEqual(parsePdfInkPoints([[1,2]]),[[1,2]]);
    for (const bad of [null, [], [[1,2],[3,"4"]], [[Infinity,0]], [[1000001,0]], Array(513).fill([1,2])]) {
      assert.equal(parsePdfInkPoints(bad),null);
    }
  });
  it("deduplicates fine samples and never exceeds the server point cap", () => {
    let points: PdfInkPoint[]=[];
    points=appendInkPoint(points,[1,2]);
    points=appendInkPoint(points,[1.01,2]);
    assert.deepEqual(points,[[1,2]]);
    for (let i=1;i<800;i++) points=appendInkPoint(points,[i*2,3]);
    assert.equal(points.length,PDF_INK_MAX_POINTS);
    assert.ok(parsePdfInkPoints(points));
  });
  it("erases by line distance including between samples, endpoints and dots", () => {
    const stroke: PdfInkPoint[]=[[0,0],[100,0]];
    assert.equal(inkStrokeHit([50,4],stroke,5),true);
    assert.equal(inkStrokeHit([50,6],stroke,5),false);
    assert.equal(inkStrokeHit([-3,0],stroke,4),true);
    assert.equal(inkStrokeHit([4,3],[[0,0]],5),true);
    assert.equal(inkStrokeHit([4,3],[],5),false);
  });
});
