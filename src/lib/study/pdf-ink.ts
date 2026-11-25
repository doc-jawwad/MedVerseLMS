import { createClient } from "@/lib/supabase/client";
import { PDF_INK_COLORS, parsePdfInkPoints, type PdfInkColor, type PdfInkPoint } from "@/lib/study/pdf-ink-geometry";

export const PDF_INK_PAGE_LIMIT = 200;
export type PdfInkStroke = {
  id: string; ownerId: string; materialId: string; revision: string; page: number;
  points: PdfInkPoint[]; color: PdfInkColor; width: number;
};
const COLUMNS = "id,student_id,material_id,content_revision,page_number,points,color,width";

export function parseInkRow(raw: unknown): PdfInkStroke | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const points = parsePdfInkPoints(r.points);
  const width = Number(r.width);
  if (!points || typeof r.id !== "string" || typeof r.student_id !== "string" || typeof r.material_id !== "string" ||
      typeof r.content_revision !== "string" || !/^[0-9a-f]{32}$/.test(r.content_revision) ||
      typeof r.page_number !== "number" || !Number.isInteger(r.page_number) ||
      r.page_number < 1 || r.page_number > 100000 ||
      !PDF_INK_COLORS.includes(r.color as PdfInkColor) ||
      !Number.isFinite(width) || width < 0.5 || width > 12) return null;
  return { id: r.id, ownerId: r.student_id, materialId: r.material_id, revision: r.content_revision,
    page: r.page_number, points, color: r.color as PdfInkColor, width };
}
export function sameInkStroke(a: PdfInkStroke, b: PdfInkStroke) {
  return a.id === b.id && a.ownerId === b.ownerId && a.materialId === b.materialId && a.revision === b.revision &&
    a.page === b.page && a.color === b.color && a.width === b.width &&
    a.points.length === b.points.length &&
    a.points.every((p, i) => p[0] === b.points[i][0] && p[1] === b.points[i][1]);
}

type Client = ReturnType<typeof createClient>;
async function verifyRevision(client: Client, materialId: string, revision: string) {
  const { data, error } = await client.rpc("pdf_ink_revision", { p_material_id: materialId });
  if (error || data !== revision) throw new Error("Pen access unavailable. Reopen the current PDF.");
}
export async function listInkPage(materialId: string, revision: string, page: number, ownerId: string) {
  const client = createClient();
  await verifyRevision(client, materialId, revision);
  const { data, error } = await client.from("pdf_ink_strokes").select(COLUMNS)
    .eq("student_id", ownerId).eq("material_id", materialId).eq("content_revision", revision).eq("page_number", page)
    .order("created_at", { ascending: true }).order("id", { ascending: true }).limit(PDF_INK_PAGE_LIMIT + 1);
  if (error) throw error;
  const rows = (data ?? []).map(parseInkRow);
  if (rows.some(r => r === null)) throw new Error("Invalid saved stroke.");
  return { rows: (rows as PdfInkStroke[]).slice(0, PDF_INK_PAGE_LIMIT), full: rows.length >= PDF_INK_PAGE_LIMIT };
}

async function verifyActor(client: Client, ownerId: string) {
  const { data, error } = await client.auth.getUser();
  if (error || data.user?.id !== ownerId) throw new Error("Account changed. Reopen the PDF.");
}

export async function saveInkStroke(stroke: PdfInkStroke): Promise<PdfInkStroke> {
  const client = createClient();
  await verifyRevision(client, stroke.materialId, stroke.revision);
  await verifyActor(client, stroke.ownerId);
  // Bind the intended owner in the same authenticated database request as the
  // insert: the session may change after getUser() and before the RPC is sent.
  // Keep the same ID on retry; never upsert or overwrite an existing row.
  const { data, error } = await client.rpc("save_pdf_ink_stroke", {
    p_expected_owner: stroke.ownerId, p_id: stroke.id, p_material_id: stroke.materialId,
    p_content_revision: stroke.revision, p_page_number: stroke.page, p_points: stroke.points,
    p_color: stroke.color, p_width: stroke.width,
  });
  if (!error) {
    const row = parseInkRow(data);
    if (row && sameInkStroke(row, stroke)) return row;
  }
  // A successful insert may have lost its response. Reconcile only exact row equality.
  const prior = await client.from("pdf_ink_strokes").select(COLUMNS)
    .eq("id", stroke.id).eq("student_id", stroke.ownerId).eq("material_id", stroke.materialId).eq("content_revision", stroke.revision).maybeSingle();
  const row = parseInkRow(prior.data);
  if (!prior.error && row && sameInkStroke(row, stroke)) return row;
  throw new Error("Drawing save not confirmed. Retry the same drawing.");
}
export async function removeInkStroke(stroke: PdfInkStroke): Promise<void> {
  const client = createClient();
  await verifyRevision(client, stroke.materialId, stroke.revision);
  await verifyActor(client, stroke.ownerId);
  const { data, error } = await client.from("pdf_ink_strokes").delete()
    .eq("id", stroke.id).eq("student_id", stroke.ownerId).eq("material_id", stroke.materialId).eq("content_revision", stroke.revision)
    .select("id");
  if (error || data?.length !== 1 || data[0].id !== stroke.id) {
    throw new Error("Drawing removal not confirmed. Reload the page annotations.");
  }
}
