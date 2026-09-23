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

export type OfflinePdfMeta = {
  materialId: string;
  title: string;
  byteSize: number;
  contentRevision: string;
  cachedAt: number;
  /** Unix ms; refreshed on successful online authorize. */
  entitlementExpiresAt: number;
  version: 1;
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

export async function readOfflinePdfBytes(
  materialId: string
): Promise<ArrayBuffer | null> {
  const meta = await getOfflineMeta(materialId);
  if (!meta) return null;
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
      await writable.write(buf);
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
