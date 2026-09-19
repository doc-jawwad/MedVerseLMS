"use server";

import { actionRpcResult } from "@/lib/errors/safe-action-error";

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
  /** Must not be sent on the atomic import path — CSV validation must pass first. */
  client_errors?: string[];
};

export type ImportChunkResult = {
  inserted: number;
  skipped: number;
  errors: number;
  question_ids: string[];
};

export async function createImportBatch(filename: string, totalRows: number) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("import_batches")
    .insert({ filename, total_rows: totalRows })
    .select("id")
    .single();
  if (error) return actionRpcResult("action", error);
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
  if (error) return actionRpcResult("action", error);
  const result = data as {
    inserted: number;
    skipped: number;
    errors: number;
    question_ids?: string[] | null;
  };
  return {
    result: {
      inserted: result.inserted,
      skipped: result.skipped,
      errors: result.errors,
      question_ids: Array.isArray(result.question_ids)
        ? result.question_ids.map(String)
        : [],
    } satisfies ImportChunkResult,
  };
}

export async function getImportReport(batchId: string) {
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("import_rows")
    .select("row_number, outcome, error_message, question_id")
    .eq("batch_id", batchId)
    .order("row_number");
  revalidatePath("/admin/questions/import");
  revalidatePath("/admin/questions");
  return { rows: rows ?? [] };
}
