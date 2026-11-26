"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";
import { listInkPage, removeInkStroke, saveInkStroke, PdfInkPageCapacityError, type PdfInkStroke } from "@/lib/study/pdf-ink";
import type { PdfInkColor, PdfInkPoint } from "@/lib/study/pdf-ink-geometry";

export type PdfInkMode = "read" | "pen" | "erase";
function subscribeOnline(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => { window.removeEventListener("online", callback); window.removeEventListener("offline", callback); };
}
function onlineSnapshot() { return navigator.onLine; }

type PageData = { key: string; rows: PdfInkStroke[]; full: boolean; error?: string };
export function usePdfInk(materialId: string, revision: string | null, page: number, allowed: boolean) {
  const online = useSyncExternalStore(subscribeOnline, onlineSnapshot, () => false);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const actorRef = useRef<string | null>(null);
  const enabled = allowed && online && revision !== null && ownerId !== null;
  const key = enabled ? ownerId + ":" + materialId + ":" + revision + ":" + page : "";
  const [mode, setMode] = useState<PdfInkMode>("read");
  const [color, setColor] = useState<PdfInkColor>("#dc2626");
  const [data, setData] = useState<PageData | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [pending, setPending] = useState<PdfInkStroke | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const lock = useRef(false);
  const pendingRef = useRef<PdfInkStroke | null>(null);

  useEffect(() => {
    const { data: { subscription } } = createClient().auth.onAuthStateChange((_event, session) => {
      const next = session?.user.id ?? null;
      if (actorRef.current !== next) {
        actorRef.current = next;
        pendingRef.current = null;
        setPending(null);
        setData(null);
        setMode("read");
        setMessage("");
        setOwnerId(next);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!key || !revision || !ownerId) return;
    let cancelled = false;
    void listInkPage(materialId, revision, page, ownerId).then(result => {
      if (!cancelled) setData({ key, ...result });
    }).catch(() => {
      if (!cancelled) setData({ key, rows: [], full: false, error: "Could not load private drawings. Retry." });
    });
    return () => { cancelled = true; };
  }, [key, materialId, revision, page, ownerId, refresh]);

  useEffect(() => {
    if (!pending) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pending]);

  const current = key && data?.key === key ? data : null;
  const ready = !!current && !current.error;
  const pendingMatches = !!pending && pending.ownerId === ownerId && pending.materialId === materialId && pending.revision === revision;
  const canDraw = enabled && ready && !busy && !pending && !current?.full;
  const canErase = enabled && ready && !busy && !pending;

  function reload() {
    setData(null);
    setRefresh(n => n + 1);
  }

  async function persist(stroke: PdfInkStroke) {
    if (lock.current || !enabled || stroke.ownerId !== actorRef.current || stroke.materialId !== materialId || stroke.revision !== revision) return;
    lock.current = true;
    pendingRef.current = stroke;
    setPending(stroke);
    setBusy(true);
    setMessage("Saving drawing…");
    try {
      const saved = await saveInkStroke(stroke);
      if (actorRef.current !== stroke.ownerId) return;
      setData(prior => prior?.key === stroke.ownerId + ":" + stroke.materialId + ":" + stroke.revision + ":" + stroke.page
        ? { ...prior, rows: [...prior.rows.filter(r => r.id !== saved.id), saved], full: prior.rows.length + 1 >= 200 }
        : prior);
      pendingRef.current = null;
      setPending(null);
      setMessage("Drawing saved");
      setRefresh(n => n + 1);
    } catch (error) {
      if (actorRef.current === stroke.ownerId) {
        setMessage(error instanceof PdfInkPageCapacityError
          ? error.message
          : "Save not confirmed. Retry the same drawing before drawing again.");
      }
    } finally { lock.current = false; setBusy(false); }
  }

  function draw(points: PdfInkPoint[]) {
    if (!canDraw || lock.current || pendingRef.current || !revision || !ownerId || !points.length) return;
    void persist({ id: crypto.randomUUID(), ownerId, materialId, revision, page, points, color, width: 2 });
  }

  async function erase(stroke: PdfInkStroke) {
    if (!canErase || lock.current || stroke.ownerId !== actorRef.current || stroke.materialId !== materialId || stroke.revision !== revision || stroke.page !== page) return;
    lock.current = true;
    setBusy(true);
    setMessage("Removing drawing…");
    try {
      await removeInkStroke(stroke);
      if (actorRef.current !== stroke.ownerId) return;
      setData(prior => prior?.key === key
        ? { ...prior, rows: prior.rows.filter(r => r.id !== stroke.id) } : prior);
      setMessage("Drawing removed");
    } catch { if (actorRef.current === stroke.ownerId) setMessage("Removal not confirmed. Refresh drawings to reconcile."); }
    finally { lock.current = false; setBusy(false); reload(); }
  }

  const rows = current?.rows ?? [];
  const shown = pendingMatches && pending!.page === page && !rows.some(r => r.id === pending!.id)
    ? [...rows, pending!] : rows;
  return {
    enabled, online, ready, mode, setMode, color, setColor, rows: enabled ? shown : [],
    pending, pendingMatches, busy, message, full: current?.full ?? false,
    error: current?.error, canDraw, canErase, draw, erase, reload,
    undo: () => { const last = rows.at(-1); if (last) void erase(last); },
    retry: () => { if (pendingRef.current) void persist(pendingRef.current); },
    discard: () => {
      if (lock.current) return;
      pendingRef.current = null;
      setPending(null);
      setMessage("Unconfirmed drawing discarded locally. Refresh to check if it saved.");
      reload();
    },
  };
}
export type PdfInkController = ReturnType<typeof usePdfInk>;
