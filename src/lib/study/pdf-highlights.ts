import { createClient } from "@/lib/supabase/client";
import {
  normalizeHighlightRects,
  type PdfHighlightRect,
} from "@/lib/study/pdf-highlight-geometry";

export type {
  PdfHighlightRect,
  ViewportRect,
} from "@/lib/study/pdf-highlight-geometry";
export {
  clientRectsToPdfRects,
  mergeNearbyRects,
  normalizeHighlightRects,
  pdfRectsToViewportBoxes,
} from "@/lib/study/pdf-highlight-geometry";

export type PdfHighlightRow = {
  id: string;
  material_id: string;
  page_number: number;
  rects: PdfHighlightRect[];
  selected_text: string;
  color: string;
};

const DEFAULT_COLOR = "#fde047";

export async function listPdfHighlights(
  materialId: string
): Promise<PdfHighlightRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("pdf_highlights")
    .select("id, material_id, page_number, rects, selected_text, color")
    .eq("material_id", materialId)
    .order("page_number", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: String(row.id),
    material_id: String(row.material_id),
    page_number: Number(row.page_number),
    rects: normalizeHighlightRects(row.rects),
    selected_text: String(row.selected_text ?? ""),
    color: String(row.color ?? DEFAULT_COLOR),
  }));
}

export async function createPdfHighlight(input: {
  materialId: string;
  pageNumber: number;
  rects: PdfHighlightRect[];
  selectedText: string;
  color?: string;
}): Promise<PdfHighlightRow> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const rects = normalizeHighlightRects(input.rects);
  if (rects.length === 0) throw new Error("Empty highlight");
  const { data, error } = await supabase
    .from("pdf_highlights")
    .insert({
      student_id: user.id,
      material_id: input.materialId,
      page_number: input.pageNumber,
      rects,
      selected_text: input.selectedText.slice(0, 4000),
      color: input.color ?? DEFAULT_COLOR,
    })
    .select("id, material_id, page_number, rects, selected_text, color")
    .single();
  if (error) throw error;
  return {
    id: String(data.id),
    material_id: String(data.material_id),
    page_number: Number(data.page_number),
    rects: normalizeHighlightRects(data.rects),
    selected_text: String(data.selected_text ?? ""),
    color: String(data.color ?? DEFAULT_COLOR),
  };
}

export async function deletePdfHighlight(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("pdf_highlights").delete().eq("id", id);
  if (error) throw error;
}
