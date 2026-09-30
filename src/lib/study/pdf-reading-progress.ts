import { createClient } from "@/lib/supabase/client";
import { clampPage } from "@/lib/study/pdf-page-clamp";

export { clampPage };

function progressKey(materialId: string): string {
  return `mv-pdf-page:${materialId}`;
}

export function readLocalSavedPage(materialId: string): number | null {
  try {
    const raw = localStorage.getItem(progressKey(materialId));
    const n = Number(raw);
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : null;
  } catch {
    return null;
  }
}

export function writeLocalSavedPage(materialId: string, page: number): void {
  try {
    localStorage.setItem(progressKey(materialId), String(page));
  } catch {
    /* quota / private mode */
  }
}

/** Server row is authoritative when available; localStorage is optimistic fallback. */
export async function loadPdfReadingPage(
  materialId: string
): Promise<number | null> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("pdf_reading_progress")
      .select("page_number")
      .eq("material_id", materialId)
      .maybeSingle();
    if (!error && data?.page_number != null) {
      const n = Number(data.page_number);
      if (Number.isFinite(n) && n >= 1) {
        writeLocalSavedPage(materialId, Math.floor(n));
        return Math.floor(n);
      }
    }
  } catch {
    /* offline / table missing — fall through */
  }
  return readLocalSavedPage(materialId);
}

export async function upsertPdfReadingPage(
  materialId: string,
  page: number
): Promise<void> {
  const pageNumber = Math.max(1, Math.floor(page));
  writeLocalSavedPage(materialId, pageNumber);
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from("pdf_reading_progress").upsert(
      {
        student_id: user.id,
        material_id: materialId,
        page_number: pageNumber,
      },
      { onConflict: "student_id,material_id" }
    );
    if (error) {
      /* entitlement denial / offline — localStorage already updated */
    }
  } catch {
    /* ignore */
  }
}

export function createDebouncedPageSaver(
  materialId: string,
  delayMs = 600
): {
  save: (page: number) => void;
  flush: () => void;
  cancel: () => void;
} {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: number | null = null;

  const flush = () => {
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending == null) return;
    const page = pending;
    pending = null;
    void upsertPdfReadingPage(materialId, page);
  };

  return {
    save(page: number) {
      pending = page;
      writeLocalSavedPage(materialId, page);
      if (timer != null) clearTimeout(timer);
      timer = setTimeout(flush, delayMs);
    },
    flush,
    cancel() {
      if (timer != null) clearTimeout(timer);
      timer = null;
      pending = null;
    },
  };
}
