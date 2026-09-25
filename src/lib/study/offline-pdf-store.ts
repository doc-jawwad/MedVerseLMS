/**
 * Application-controlled offline PDF store (OPFS + IndexedDB metadata).
 * Documents are NOT written to the user Downloads folder.
 *
 * Bytes live in origin-private OPFS. Absolute browser DRM is impossible for
 * offline-readable content — we rely on entitlement sync + in-app reader only.
 */

const DB_NAME = "medverse-pdf-offline-v1";
const META_STORE = "meta";
const DB_VERSION = 1;

export type OfflineSaveStatus = "available" | "saving" | "failed";

export type OfflinePdfMeta = {
  materialId: string;
  title: string;
  byteSize: number;
  contentRevision: string;
  cachedAt: number;
  /** Unix ms; refreshed on successful online authorize. */
  entitlementExpiresAt: number;
  version: 1;
  /** Transient save progress for Offline Library; omit once fully available. */
  saveStatus?: OfflineSaveStatus;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: "materialId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("idb_open_failed"));
  });
}

function idbGet<T>(store: string, key: string): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(store, "readonly");
        const req = tx.objectStore(store).get(key);
        req.onsuccess = () => resolve(req.result as T | undefined);
        req.onerror = () => reject(req.error);
      })
  );
}

function idbPut(store: string, value: unknown): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(store, "readwrite");
        tx.objectStore(store).put(value);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      })
  );
}

function idbDelete(store: string, key: string): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(store, "readwrite");
        tx.objectStore(store).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      })
  );
}

async function getOpfsRoot(): Promise<FileSystemDirectoryHandle> {
  if (!navigator.storage?.getDirectory) {
    throw new Error("opfs_unavailable");
  }
  return navigator.storage.getDirectory();
}

function opfsName(materialId: string): string {
  return `pdf-${materialId.replace(/[^a-zA-Z0-9_-]/g, "_")}.pdf`;
}

export async function getOfflineMeta(
  materialId: string
): Promise<OfflinePdfMeta | null> {
  return (await idbGet<OfflinePdfMeta>(META_STORE, materialId)) ?? null;
}

export async function listOfflineMetas(): Promise<OfflinePdfMeta[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE, "readonly");
    const req = tx.objectStore(META_STORE).getAll();
    req.onsuccess = () => resolve((req.result as OfflinePdfMeta[]) ?? []);
    req.onerror = () => reject(req.error);
  });
}

export async function removeOfflinePdf(materialId: string): Promise<void> {
  await idbDelete(META_STORE, materialId);
  try {
    const root = await getOpfsRoot();
    await root.removeEntry(opfsName(materialId));
  } catch {
    /* missing ok */
  }
}

/**
 * Full-file ArrayBuffer read — avoid for large PDFs. Prefer
 * createOpfsPdfRangeTransport / readOfflinePdfRange.
 */
export async function readOfflinePdfBytes(
  materialId: string
): Promise<ArrayBuffer | null> {
  const meta = await getOfflineMeta(materialId);
  if (!meta) return null;
  if (meta.saveStatus === "saving" || meta.saveStatus === "failed") {
    return null;
  }
  if (meta.entitlementExpiresAt > 0 && Date.now() > meta.entitlementExpiresAt) {
    return null;
  }
  try {
    const root = await getOpfsRoot();
    const handle = await root.getFileHandle(opfsName(materialId));
    const file = await handle.getFile();
    return file.arrayBuffer();
  } catch {
    return null;
  }
}

/** Mark Offline Library row as Saving… before range stream starts. */
export async function markOfflineSavePending(options: {
  materialId: string;
  title: string;
  byteSize: number;
  contentRevision: string;
  entitlementExpiresAt: number;
}): Promise<void> {
  await idbPut(META_STORE, {
    materialId: options.materialId,
    title: options.title,
    byteSize: options.byteSize,
    contentRevision: options.contentRevision,
    cachedAt: Date.now(),
    entitlementExpiresAt: options.entitlementExpiresAt,
    version: 1,
    saveStatus: "saving",
  } satisfies OfflinePdfMeta);
}

export async function markOfflineSaveFailed(materialId: string): Promise<void> {
  const meta = await getOfflineMeta(materialId);
  if (!meta) return;
  await idbPut(META_STORE, { ...meta, saveStatus: "failed" });
}

/**
 * Read a byte range from the OPFS offline PDF via File.slice (does not load
 * the entire file into JS memory). `endExclusive` matches PDF.js range end.
 */
export async function readOfflinePdfRange(
  materialId: string,
  begin: number,
  endExclusive: number
): Promise<Uint8Array | null> {
  const meta = await getOfflineMeta(materialId);
  if (!meta) return null;
  if (meta.saveStatus === "saving" || meta.saveStatus === "failed") {
    return null;
  }
  if (meta.entitlementExpiresAt > 0 && Date.now() > meta.entitlementExpiresAt) {
    return null;
  }
  if (begin < 0 || endExclusive <= begin) return new Uint8Array(0);
  try {
    const root = await getOpfsRoot();
    const handle = await root.getFileHandle(opfsName(materialId));
    const file = await handle.getFile();
    const end = Math.min(endExclusive, file.size);
    const start = Math.min(begin, end);
    const ab = await file.slice(start, end).arrayBuffer();
    const out = new Uint8Array(ab.byteLength);
    out.set(new Uint8Array(ab));
    return out;
  } catch {
    return null;
  }
}

export async function getOfflinePdfByteLength(
  materialId: string
): Promise<number | null> {
  const meta = await getOfflineMeta(materialId);
  if (!meta) return null;
  if (meta.entitlementExpiresAt > 0 && Date.now() > meta.entitlementExpiresAt) {
    return null;
  }
  try {
    const root = await getOpfsRoot();
    const handle = await root.getFileHandle(opfsName(materialId));
    const file = await handle.getFile();
    return file.size;
  } catch {
    return meta.byteSize > 0 ? meta.byteSize : null;
  }
}

type PdfjsModule = typeof import("pdfjs-dist");

/**
 * PDF.js PDFDataRangeTransport backed by OPFS File.slice ranges.
 */
export async function createOpfsPdfRangeTransport(
  pdfjs: PdfjsModule,
  materialId: string
): Promise<{
  transport: InstanceType<PdfjsModule["PDFDataRangeTransport"]>;
  meta: OfflinePdfMeta;
  length: number;
} | null> {
  const meta = await getOfflineMeta(materialId);
  if (!meta) return null;
  if (meta.saveStatus === "saving" || meta.saveStatus === "failed") {
    return null;
  }
  if (meta.entitlementExpiresAt > 0 && Date.now() > meta.entitlementExpiresAt) {
    return null;
  }
  const length = (await getOfflinePdfByteLength(materialId)) ?? meta.byteSize;
  if (!length || length <= 0) return null;

  const initialLen = Math.min(65536, length);
  const initial = await readOfflinePdfRange(materialId, 0, initialLen);
  if (!initial) return null;

  const Base = pdfjs.PDFDataRangeTransport;
  class OpfsRangeTransport extends Base {
    requestDataRange(begin: number, end: number) {
      void (async () => {
        try {
          const chunk = await readOfflinePdfRange(materialId, begin, end);
          this.onDataRange(begin, chunk);
        } catch {
          this.onDataRange(begin, null);
        }
      })();
    }
  }

  const transport = new OpfsRangeTransport(length, initial);
  return { transport, meta, length };
}

const ONLINE_RANGE_MAX_ATTEMPTS = 3;

async function fetchStudyContentRange(
  url: string,
  begin: number,
  endExclusive: number,
  signal?: AbortSignal
): Promise<Uint8Array> {
  // PDF.js end is exclusive; HTTP Range end is inclusive.
  const endInclusive = Math.max(begin, endExclusive - 1);
  let lastErr = "online_range_failed";
  for (let attempt = 0; attempt < ONLINE_RANGE_MAX_ATTEMPTS; attempt++) {
    if (signal?.aborted) throw new Error("online_range_aborted");
    try {
      const res = await fetch(url, {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: { Range: `bytes=${begin}-${endInclusive}` },
        signal,
      });
      if (res.status === 403) throw new Error("study_object_denied");
      if (res.status !== 206 && res.status !== 200) {
        lastErr = `online_range_failed:${res.status}`;
        await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
        continue;
      }
      const buf = new Uint8Array(await res.arrayBuffer());
      // Copy out of the potentially pooled ArrayBuffer backing store.
      const out = new Uint8Array(buf.byteLength);
      out.set(buf);
      return out;
    } catch (e) {
      if (e instanceof Error && e.message === "study_object_denied") throw e;
      if (e instanceof Error && e.name === "AbortError") {
        throw new Error("online_range_aborted");
      }
      lastErr = e instanceof Error ? e.message : lastErr;
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
    }
  }
  throw new Error(lastErr);
}

/**
 * Online PDF.js PDFDataRangeTransport.
 *
 * PDF.js url-mode validateRangeRequestCapabilities() uses Content-Length only
 * (ignores Content-Range total). Our study-content unscoped GET returns a
 * coerced leading 206 with Content-Length=65536, so PDF.js disables ranges and
 * treats 64 KiB as the whole file → "Invalid PDF structure" on real PDFs.
 * Explicit Range fetches with known length avoid that path entirely.
 */
export async function createOnlinePdfRangeTransport(
  pdfjs: PdfjsModule,
  options: {
    materialId: string;
    length: number;
    signal?: AbortSignal;
  }
): Promise<{
  transport: InstanceType<PdfjsModule["PDFDataRangeTransport"]>;
  length: number;
}> {
  const length = options.length;
  if (!Number.isFinite(length) || length <= 0) {
    throw new Error("online_size_unknown");
  }
  const url = `/api/study-content/${options.materialId}`;
  const initialLen = Math.min(65536, length);
  const initial = await fetchStudyContentRange(
    url,
    0,
    initialLen,
    options.signal
  );

  const Base = pdfjs.PDFDataRangeTransport;
  class OnlineRangeTransport extends Base {
    requestDataRange(begin: number, end: number) {
      void (async () => {
        try {
          if (options.signal?.aborted) {
            this.onDataRange(begin, null);
            return;
          }
          const chunk = await fetchStudyContentRange(
            url,
            begin,
            end,
            options.signal
          );
          this.onDataRange(begin, chunk);
        } catch {
          this.onDataRange(begin, null);
        }
      })();
    }
  }

  const transport = new OnlineRangeTransport(length, initial);
  return { transport, length };
}

export type OfflineSaveProgress = {
  loaded: number;
  total: number;
};

/**
 * Stream authorized ranges into OPFS without assembling the whole file in RAM.
 */
export async function savePdfForOffline(options: {
  materialId: string;
  title: string;
  contentRevision: string;
  entitlementExpiresAt: number;
  signal?: AbortSignal;
  onProgress?: (p: OfflineSaveProgress) => void;
}): Promise<OfflinePdfMeta> {
  const url = `/api/study-content/${options.materialId}`;
  const head = await fetch(url, {
    method: "HEAD",
    credentials: "same-origin",
    cache: "no-store",
    signal: options.signal,
  });
  if (head.status === 403) throw new Error("study_object_denied");
  if (!head.ok) throw new Error("offline_head_failed");
  const total = Number(head.headers.get("content-length") ?? "0");
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error("offline_size_unknown");
  }

  const root = await getOpfsRoot();
  const handle = await root.getFileHandle(opfsName(options.materialId), {
    create: true,
  });
  const writable = await handle.createWritable();
  const chunkSize = 2 * 1024 * 1024;
  let loaded = 0;
  try {
    for (let start = 0; start < total; start += chunkSize) {
      if (options.signal?.aborted) throw new Error("offline_cancelled");
      const end = Math.min(start + chunkSize - 1, total - 1);
      let buf: Uint8Array | null = null;
      let lastErr = "offline_range_failed";
      for (let attempt = 0; attempt < 3; attempt++) {
        if (options.signal?.aborted) throw new Error("offline_cancelled");
        try {
          const res = await fetch(url, {
            method: "GET",
            credentials: "same-origin",
            cache: "no-store",
            headers: { Range: `bytes=${start}-${end}` },
            signal: options.signal,
          });
          if (res.status === 403) throw new Error("study_object_denied");
          if (res.status !== 206 && res.status !== 200) {
            lastErr = `offline_range_failed:${res.status}`;
            continue;
          }
          buf = new Uint8Array(await res.arrayBuffer());
          break;
        } catch (e) {
          if (e instanceof Error && e.message === "study_object_denied") {
            throw e;
          }
          if (e instanceof Error && e.message === "offline_cancelled") {
            throw e;
          }
          lastErr = e instanceof Error ? e.message : lastErr;
          await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
        }
      }
      if (!buf) throw new Error(lastErr);
      const chunk = new Uint8Array(buf.byteLength);
      chunk.set(buf);
      await writable.write(chunk);
      loaded += buf.byteLength;
      options.onProgress?.({ loaded, total });
    }
    await writable.close();
  } catch (e) {
    try {
      await writable.abort();
    } catch {
      /* ignore */
    }
    throw e;
  }

  const meta: OfflinePdfMeta = {
    materialId: options.materialId,
    title: options.title,
    byteSize: total,
    contentRevision: options.contentRevision || String(total),
    cachedAt: Date.now(),
    entitlementExpiresAt: options.entitlementExpiresAt,
    version: 1,
    saveStatus: "available",
  };
  await idbPut(META_STORE, meta);
  return meta;
}

export async function touchOfflineEntitlement(
  materialId: string,
  entitlementExpiresAt: number
): Promise<void> {
  const meta = await getOfflineMeta(materialId);
  if (!meta) return;
  await idbPut(META_STORE, { ...meta, entitlementExpiresAt });
}

export async function purgeExpiredOffline(): Promise<number> {
  const all = await listOfflineMetas();
  let n = 0;
  const now = Date.now();
  for (const m of all) {
    if (m.entitlementExpiresAt > 0 && now > m.entitlementExpiresAt) {
      await removeOfflinePdf(m.materialId);
      n += 1;
    }
  }
  return n;
}

/** Origin storage estimate for pre-save quota checks (OPFS-backed). */
export async function estimateOfflineQuota(): Promise<{
  usage: number;
  quota: number;
  remaining: number;
} | null> {
  if (!navigator.storage?.estimate) return null;
  try {
    const est = await navigator.storage.estimate();
    const usage = Number(est.usage ?? 0);
    const quota = Number(est.quota ?? 0);
    if (!Number.isFinite(quota) || quota <= 0) return null;
    return {
      usage,
      quota,
      remaining: Math.max(0, quota - usage),
    };
  } catch {
    return null;
  }
}

export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export async function totalOfflineBytes(): Promise<number> {
  const all = await listOfflineMetas();
  return all.reduce((sum, m) => sum + (m.byteSize || 0), 0);
}
