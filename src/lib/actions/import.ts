"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ImportRow = {
  row_number: number;
  subject_id: string;
  book: string;
  chapter: string;
  topic: string;
  stem: string;
  options: { key: string; text: string }[];
  correct_key: string;
  explanation: string;
  reference: string;
  difficulty: string;
  tags: string[];
  status: string;
};

export async function createImportBatch(filename: string, totalRows: number) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("import_batches")
    .insert({ filename, total_rows: totalRows })
    .select("id")
    .single();
  if (error) return { error: error.message };
  return { id: data.id as string };
}

export async function importChunk(
  batchId: string,
  rows: ImportRow[],
  createMissing: boolean
) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("import_question_batch", {
    p_batch_id: batchId,
    p_rows: rows,
    p_create_missing: createMissing,
  });
  if (error) return { error: error.message };
  return {
    result: data as { inserted: number; skipped: number; errors: number },
  };
}

export async function getImportReport(batchId: string) {
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("import_rows")
    .select("row_number, outcome, error_message")
    .eq("batch_id", batchId)
    .order("row_number");
  revalidatePath("/admin/questions/import");
  return { rows: rows ?? [] };
}
