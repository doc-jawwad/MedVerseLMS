"use client";
import { Button } from "@/components/ui/button";
import { PDF_INK_COLORS, type PdfInkColor } from "@/lib/study/pdf-ink-geometry";
import type { PdfInkController, PdfInkMode } from "./use-pdf-ink";

export function PdfInkToolbar({ ink, page, onMode, onClose }: {
  ink: PdfInkController; page: number; onMode: (mode: PdfInkMode) => void; onClose: () => void;
}) {
  const colorNames = ["Red", "Blue", "Black", "Green"];
  return <div role="group" aria-label="PDF pen controls" data-testid="pdf-ink-toolbar"
    className="pointer-events-auto absolute inset-x-0 bottom-0 z-30 flex flex-wrap items-center gap-1 bg-neutral-950/85 px-2 py-1.5 text-white backdrop-blur-sm pdf-safe-bottom">
    <Button type="button" size="sm" variant={ink.mode === "read" ? "secondary" : "ghost"}
      className={ink.mode === "read" ? "" : "text-white"} aria-pressed={ink.mode === "read"} onClick={() => onMode("read")}>Read</Button>
    <Button type="button" size="sm" variant={ink.mode === "pen" ? "secondary" : "ghost"}
      className={ink.mode === "pen" ? "" : "text-white"} aria-pressed={ink.mode === "pen"}
      disabled={!ink.canDraw} onClick={() => onMode("pen")} data-testid="pdf-ink-pen">Pen</Button>
    <Button type="button" size="sm" variant={ink.mode === "erase" ? "secondary" : "ghost"}
      className={ink.mode === "erase" ? "" : "text-white"} aria-pressed={ink.mode === "erase"}
      disabled={!ink.canErase} onClick={() => onMode("erase")} data-testid="pdf-ink-eraser">Erase</Button>
    <select aria-label="Pen colour" className="h-8 rounded border border-white/30 bg-neutral-900 px-1 text-xs text-white"
      value={ink.color} disabled={ink.busy || !!ink.pending}
      onChange={e => ink.setColor(e.target.value as PdfInkColor)}>
      {PDF_INK_COLORS.map((color,i) => <option value={color} key={color}>{colorNames[i]}</option>)}
    </select>
    <Button type="button" size="sm" variant="ghost" className="text-white" onClick={ink.undo}
      disabled={!ink.canErase || !ink.rows.length} data-testid="pdf-ink-undo">Undo last</Button>
    {ink.error && <Button type="button" size="sm" variant="secondary" onClick={ink.reload}>Retry load</Button>}
    {ink.pending && !ink.busy && <>
      <Button type="button" size="sm" variant="secondary" disabled={!ink.enabled || !ink.pendingMatches}
        onClick={ink.retry}>Retry save</Button>
      <Button type="button" size="sm" variant="ghost" className="text-white" onClick={ink.discard}>Discard unsaved</Button>
    </>}
    <Button type="button" size="sm" variant="ghost" className="text-white" onClick={onClose} disabled={!!ink.pending || ink.busy}>Close</Button>
    <span className="basis-full text-xs text-white/80" role="status" data-testid="pdf-ink-status">
      {!ink.enabled ? "Pen editing requires the online PDF."
        : ink.pending && !ink.pendingMatches ? "Document changed. Discard the unconfirmed drawing."
        : ink.error ?? (ink.full ? "Page drawing limit reached. Erase a stroke to continue."
        : ink.message || (ink.ready ? "Draw on page " + page + " · Read mode to scroll" : "Loading drawings…"))}
    </span>
  </div>;
}
