/** PDF-space ink geometry. No DOM, network or storage dependency. */
export const PDF_INK_MAX_POINTS = 512;
export const PDF_INK_MAX_COORD = 1_000_000;
export const PDF_INK_COLORS = ["#dc2626", "#2563eb", "#111827", "#16a34a"] as const;
export type PdfInkColor = typeof PDF_INK_COLORS[number];
export type PdfInkPoint = readonly [number, number];

type InkViewport = {
  width: number;
  height: number;
  convertToPdfPoint(x: number, y: number): number[];
  convertToViewportPoint(x: number, y: number): number[];
};
type Box = { left: number; top: number; width: number; height: number };

export function isPdfInkPoint(value: unknown): value is PdfInkPoint {
  return Array.isArray(value) && value.length === 2 &&
    value.every(v => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= PDF_INK_MAX_COORD);
}

/** Reject the entire malformed stroke rather than silently losing its shape. */
export function parsePdfInkPoints(value: unknown): PdfInkPoint[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > PDF_INK_MAX_POINTS ||
      !value.every(isPdfInkPoint)) return null;
  return value.map(([x, y]) => [x, y]);
}

function clamp(value: number, upper: number) {
  return Math.max(0, Math.min(value, upper));
}

/** Convert a captured pointer to PDF page coordinates using the actual painted box. */
export function clientToInkPoint(
  viewport: InkViewport,
  box: Box,
  clientX: number,
  clientY: number,
): PdfInkPoint | null {
  if (![box.left, box.top, box.width, box.height, viewport.width, viewport.height, clientX, clientY].every(Number.isFinite) ||
      box.width <= 0 || box.height <= 0 || viewport.width <= 0 || viewport.height <= 0) return null;
  const x = clamp((clientX - box.left) / box.width, 1) * viewport.width;
  const y = clamp((clientY - box.top) / box.height, 1) * viewport.height;
  const point = viewport.convertToPdfPoint(x, y);
  if (!isPdfInkPoint(point)) return null;
  return [Math.round(point[0] * 1000) / 1000, Math.round(point[1] * 1000) / 1000];
}

/** Append only meaningful samples; stop at the bounded server-side point limit. */
export function appendInkPoint(points: readonly PdfInkPoint[], point: PdfInkPoint): PdfInkPoint[] {
  if (!isPdfInkPoint(point) || points.length >= PDF_INK_MAX_POINTS) return [...points];
  const last = points[points.length - 1];
  if (last && Math.hypot(point[0] - last[0], point[1] - last[1]) < 0.35) return [...points];
  return [...points, point];
}

export function inkViewportPoints(viewport: InkViewport, points: readonly PdfInkPoint[]): PdfInkPoint[] | null {
  const out: PdfInkPoint[] = [];
  for (const point of points) {
    if (!isPdfInkPoint(point)) return null;
    const p = viewport.convertToViewportPoint(point[0], point[1]);
    if (p.length !== 2 || !p.every(Number.isFinite)) return null;
    out.push([p[0], p[1]]);
  }
  return out;
}

function segmentDistance(point: PdfInkPoint, a: PdfInkPoint, b: PdfInkPoint): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const squared = dx * dx + dy * dy;
  const t = squared > 0
    ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / squared))
    : 0;
  return Math.hypot(point[0] - (a[0] + t * dx), point[1] - (a[1] + t * dy));
}

/** Hit-test the rendered line, not just its sampled vertices. Works for single-point dots. */
export function inkStrokeHit(point: PdfInkPoint, stroke: readonly PdfInkPoint[], radius: number): boolean {
  if (!Number.isFinite(radius) || radius < 0 || !isPdfInkPoint(point) || !stroke.length ||
      !stroke.every(isPdfInkPoint)) return false;
  if (stroke.length === 1) return segmentDistance(point, stroke[0], stroke[0]) <= radius;
  return stroke.some((p, i) => i > 0 && segmentDistance(point, stroke[i - 1], p) <= radius);
}
