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

// ---------------------------------------------------------------------------
// Pearl point import
// ---------------------------------------------------------------------------

export type PearlImportRow = {
  row_number: number;
  prompt: string;
  answer: string;
  explanation: string;
  subject: string;
  chapter: string;
  topic: string;
  entitlement: string;
  sort_order: number;
  client_errors?: string[];
};

export async function createPearlImportBatch(
  yearId: string,
  filename: string,
  totalRows: number
) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("pearl_import_batches")
    .insert({ year_id: yearId, filename, total_rows: totalRows })
    .select("id")
    .single();
  if (error) return actionRpcResult("createPearlImportBatch", error);
  return { id: data.id as string };
}

export async function importPearlChunk(
  yearId: string,
  batchId: string,
  rows: PearlImportRow[]
) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("import_pearl_batch", {
    p_year_id: yearId,
    p_batch_id: batchId,
    p_rows: rows,
  });
  if (error) return actionRpcResult("importPearlChunk", error);
  const result = data as { inserted: number; skipped: number; errors: number };
  return { result: { inserted: result.inserted, skipped: result.skipped, errors: result.errors } };
}

export async function getPearlImportReport(batchId: string) {
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("pearl_import_rows")
    .select("row_number, outcome, error_message")
    .eq("batch_id", batchId)
    .order("row_number");
  revalidatePath("/admin/pearls/import");
  revalidatePath("/admin/pearls");
  return { rows: rows ?? [] };
}

// ---------------------------------------------------------------------------
// One-liner import
// ---------------------------------------------------------------------------

export type OneLinerImportRow = {
  row_number: number;
  title: string;
  body: string;
  subject: string;
  status: string;
  client_errors?: string[];
};

export async function createOneLinerImportBatch(
  yearId: string,
  filename: string,
  totalRows: number
) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("one_liner_import_batches")
    .insert({ year_id: yearId, filename, total_rows: totalRows })
    .select("id")
    .single();
  if (error) return actionRpcResult("createOneLinerImportBatch", error);
  return { id: data.id as string };
}

export async function importOneLinerChunk(
  yearId: string,
  batchId: string,
  rows: OneLinerImportRow[]
) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("import_one_liner_batch", {
    p_year_id: yearId,
    p_batch_id: batchId,
    p_rows: rows,
  });
  if (error) return actionRpcResult("importOneLinerChunk", error);
  const result = data as { inserted: number; skipped: number; errors: number };
  return { result: { inserted: result.inserted, skipped: result.skipped, errors: result.errors } };
}

export async function getOneLinerImportReport(batchId: string) {
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("one_liner_import_rows")
    .select("row_number, outcome, error_message")
    .eq("batch_id", batchId)
    .order("row_number");
  revalidatePath("/admin/one-liners/import");
  revalidatePath("/admin/one-liners");
  return { rows: rows ?? [] };
}
