"use client";
import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { appendInkPoint, clientToInkPoint, inkStrokeHit, inkViewportPoints,
  type PdfInkPoint } from "@/lib/study/pdf-ink-geometry";
import type { PdfInkController } from "./use-pdf-ink";
import type { PdfPageViewport } from "./pdf-page-slot";

export function PdfInkLayer({ viewport, ink }: { viewport: PdfPageViewport; ink: PdfInkController }) {
  const active = useRef<{ id: number; points: PdfInkPoint[] } | null>(null);
  const [draft, setDraft] = useState<PdfInkPoint[]>([]);
  const mode = ink.mode === "pen" && ink.canDraw ? "pen"
    : ink.mode === "erase" && ink.canErase ? "erase" : "read";
  function point(e: ReactPointerEvent<SVGSVGElement>) {
    return clientToInkPoint(viewport, e.currentTarget.getBoundingClientRect(), e.clientX, e.clientY);
  }
  function clear() { active.current = null; setDraft([]); }
  function down(e: ReactPointerEvent<SVGSVGElement>) {
    if (mode === "read" || !e.isPrimary || e.button !== 0 || active.current) return;
    const p = point(e);
    if (!p) return;
    e.preventDefault(); e.stopPropagation();
    if (mode === "erase") {
      const hit = [...ink.rows].reverse().find(s => inkStrokeHit(p, s.points, 8 / viewport.scale + s.width / 2));
      if (hit) void ink.erase(hit);
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    active.current = { id: e.pointerId, points: [p] };
    setDraft([p]);
  }
  function move(e: ReactPointerEvent<SVGSVGElement>) {
    if (active.current?.id !== e.pointerId) return;
    e.preventDefault(); e.stopPropagation();
    if (mode !== "pen") { clear(); return; }
    const p = point(e);
    if (!p) return;
    const points = appendInkPoint(active.current.points, p);
    active.current.points = points;
    setDraft(points);
  }
  function up(e: ReactPointerEvent<SVGSVGElement>) {
    if (mode !== "read" || active.current) e.stopPropagation();
    if (active.current?.id !== e.pointerId) return;
    const p = point(e);
    const points = p ? appendInkPoint(active.current.points, p) : active.current.points;
    clear();
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (mode === "pen") ink.draw(points);
  }
  function renderStroke(id: string, points: readonly PdfInkPoint[], color: string, width: number) {
    const p = inkViewportPoints(viewport, points);
    if (!p?.length) return null;
    const strokeWidth = width * viewport.scale;
    return p.length === 1
      ? <circle key={id} data-ink-id={id} cx={p[0][0]} cy={p[0][1]} r={strokeWidth / 2} fill={color} />
      : <polyline key={id} data-ink-id={id} points={p.map(([x,y]) => x + "," + y).join(" ")}
          fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />;
  }
  return <svg aria-hidden="true" data-testid="pdf-ink-layer" data-ink-mode={mode}
    className="absolute inset-0 z-[2] h-full w-full"
    style={{ pointerEvents: mode === "read" ? "none" : "auto", touchAction: mode === "read" ? "auto" : "none",
      cursor: mode === "pen" ? "crosshair" : mode === "erase" ? "cell" : undefined }}
    viewBox={"0 0 " + viewport.width + " " + viewport.height} preserveAspectRatio="none"
    onPointerDown={down} onPointerMove={move} onPointerUp={up}
    onPointerCancel={clear} onLostPointerCapture={clear}
    onTouchStart={e => { if (mode !== "read") e.stopPropagation(); }}
    onTouchMove={e => { if (mode !== "read") e.stopPropagation(); }}
    onTouchEnd={e => { if (mode !== "read") e.stopPropagation(); }}>
    {ink.rows.map(s => renderStroke(s.id,s.points,s.color,s.width))}
    {renderStroke("draft",draft,ink.color,2)}
  </svg>;
}
