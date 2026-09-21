"use server";

import { revalidatePath } from "next/cache";
import { actionRpcResult } from "@/lib/errors/safe-action-error";
import { createClient } from "@/lib/supabase/server";
import { moveContentToBin } from "@/lib/actions/content-bin";

export type OneLinerInput = {
  year_id: string;
  subject_id: string;
  title: string;
  body: string;
  status?: "draft" | "published";
};

function reval() {
  revalidatePath("/admin/one-liners");
}

export async function createOneLiner(input: OneLinerInput) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_one_liner", {
    p_year_id: input.year_id,
    p_subject_id: input.subject_id,
    p_title: input.title,
    p_body: input.body,
    p_status: input.status ?? "draft",
  });
  reval();
  if (error) return actionRpcResult("createOneLiner", error);
  return { id: data as string };
}

export async function updateOneLiner(
  id: string,
  input: Partial<OneLinerInput>
) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_one_liner", {
    p_id: id,
    p_title: input.title ?? null,
    p_body: input.body ?? null,
    p_subject_id: input.subject_id ?? null,
    p_status: input.status ?? null,
  });
  reval();
  revalidatePath(`/admin/one-liners/${id}`);
  return actionRpcResult("updateOneLiner", error);
}

export async function setOneLinerStatus(id: string, status: "draft" | "published") {
  return updateOneLiner(id, { status });
}

export async function moveOneLinerToBin(id: string) {
  return moveContentToBin("one_liner", id);
}
