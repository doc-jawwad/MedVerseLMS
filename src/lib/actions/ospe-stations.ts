"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { readAdminSelectedYearId } from "@/lib/admin/selected-class";
import {
  actionRpcResult,
  clientActionFailed,
  toClientActionError,
} from "@/lib/errors/safe-action-error";
import { createClient } from "@/lib/supabase/server";
import { deleteR2Object, putR2Object } from "@/lib/r2/presign";
import { isOspeStationImageFile } from "@/lib/study/upload-rules";
import { allocateStudyObjectKey } from "@/lib/actions/study-content";
import { moveContentToBin } from "@/lib/actions/content-bin";

function revalidateOspe(id?: string) {
  revalidatePath("/admin/ospe-stations");
  revalidatePath("/admin/free-resources");
  revalidatePath("/admin/bin");
  revalidatePath("/practice/ospe");
  revalidatePath("/free-resources");
  if (id) revalidatePath(`/admin/ospe-stations/${id}`);
}

async function discardStudyKey(
  supabase: Awaited<ReturnType<typeof createClient>>,
  key: string
) {
  const { error } = await supabase.rpc("authorize_study_object_discard", {
    p_object_key: key,
  });
  if (error) return;
  await deleteR2Object({ key });
}

export type OspeStationInput = {
  title: string;
  answer: string;
  yearId: string;
  subjectId: string;
  status?: "draft" | "published";
  sortOrder?: number;
};

export async function createOspeStation(formData: FormData) {
  const selectedYearId = await readAdminSelectedYearId();
  if (!selectedYearId) {
    return { error: "Select a class before creating an OSPE station." };
  }

  const title = String(formData.get("title") ?? "").trim();
  const answer = String(formData.get("answer") ?? "").trim();
  const subjectId = String(formData.get("subjectId") ?? "");
  const status =
    String(formData.get("status") ?? "draft") === "published"
      ? "published"
      : "draft";
  const sortOrder = Number(formData.get("sortOrder") ?? 0) || 0;
  const file = formData.get("image");

  if (!title || !answer || !subjectId) {
    return { error: "Title, answer, and subject are required." };
  }
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a station image (JPEG, PNG, or WebP)." };
  }
  const imageErr = isOspeStationImageFile(file);
  if (imageErr) return { error: imageErr };

  const supabase = await createClient();
  const { data: subject } = await supabase
    .from("subjects")
    .select("year_id")
    .eq("id", subjectId)
    .maybeSingle();
  if (!subject || subject.year_id !== selectedYearId) {
    return { error: "Subject must belong to the selected class." };
  }

  const allocated = await allocateStudyObjectKey();
  if ("error" in allocated && allocated.error) return allocated;
  if (!("key" in allocated)) return { error: "study_object_denied" };
  const key = allocated.key;

  const uploaded = await putR2Object({
    key,
    body: Buffer.from(await file.arrayBuffer()),
    contentType: file.type,
  });
  if (uploaded.error) {
    await discardStudyKey(supabase, key);
    return clientActionFailed("createOspeStation.put", uploaded.error);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from("ospe_stations")
    .insert({
      title,
      answer,
      year_id: selectedYearId,
      subject_id: subjectId,
      status,
      sort_order: sortOrder,
      r2_object_key: key,
      r2_content_type: file.type,
      r2_byte_size: file.size,
      created_by: user?.id ?? null,
    })
    .select("id")
    .single();

  if (error) {
    await discardStudyKey(supabase, key);
    return { error: toClientActionError(error, "createOspeStation.insert") };
  }

  revalidateOspe();
  redirect(`/admin/ospe-stations/${data.id}`);
}

export async function updateOspeStation(id: string, formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  const answer = String(formData.get("answer") ?? "").trim();
  const subjectId = String(formData.get("subjectId") ?? "");
  const yearId = String(formData.get("yearId") ?? "");
  const status =
    String(formData.get("status") ?? "draft") === "published"
      ? "published"
      : "draft";
  const sortOrder = Number(formData.get("sortOrder") ?? 0) || 0;
  const file = formData.get("image");

  if (!title || !answer || !subjectId || !yearId) {
    return { error: "Title, answer, year, and subject are required." };
  }

  const supabase = await createClient();
  const { data: adminRow, error: adminErr } = await supabase.rpc(
    "get_ospe_station_for_admin",
    { p_station_id: id }
  );
  if (adminErr || !adminRow) {
    return actionRpcResult("updateOspeStation.load", adminErr);
  }
  const existing = adminRow as {
    r2_object_key: string;
    year_id: string;
  };

  let nextKey = existing.r2_object_key;
  let nextType: string | undefined;
  let nextSize: number | undefined;
  let previousKey: string | null = null;

  if (file instanceof File && file.size > 0) {
    const imageErr = isOspeStationImageFile(file);
    if (imageErr) return { error: imageErr };

    const allocated = await allocateStudyObjectKey();
    if ("error" in allocated && allocated.error) return allocated;
    if (!("key" in allocated)) return { error: "study_object_denied" };

    const uploaded = await putR2Object({
      key: allocated.key,
      body: Buffer.from(await file.arrayBuffer()),
      contentType: file.type,
    });
    if (uploaded.error) {
      await discardStudyKey(supabase, allocated.key);
      return clientActionFailed("updateOspeStation.put", uploaded.error);
    }
    previousKey = existing.r2_object_key;
    nextKey = allocated.key;
    nextType = file.type;
    nextSize = file.size;
  }

  const { error } = await supabase
    .from("ospe_stations")
    .update({
      title,
      answer,
      year_id: yearId,
      subject_id: subjectId,
      status,
      sort_order: sortOrder,
      r2_object_key: nextKey,
      ...(nextType ? { r2_content_type: nextType } : {}),
      ...(nextSize != null ? { r2_byte_size: nextSize } : {}),
    })
    .eq("id", id);

  if (error) {
    if (previousKey && nextKey !== previousKey) {
      await discardStudyKey(supabase, nextKey);
    }
    return { error: toClientActionError(error, "updateOspeStation") };
  }

  if (previousKey && previousKey !== nextKey) {
    await discardStudyKey(supabase, previousKey);
  }

  revalidateOspe(id);
  return {};
}

export async function setOspeStationStatus(
  id: string,
  status: "draft" | "published"
) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("ospe_stations")
    .update({ status })
    .eq("id", id);
  revalidateOspe(id);
  return actionRpcResult("setOspeStationStatus", error);
}

export async function deleteOspeStation(id: string) {
  // Soft-delete only — R2 is retained until permanent purge via content bin.
  const result = await moveContentToBin("ospe_station", id);
  if (result.error) return result;
  revalidateOspe();
  redirect("/admin/ospe-stations");
}

export async function openOspeStation(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("open_ospe_station", {
    p_station_id: id,
  });
  if (error) return actionRpcResult("openOspeStation", error);
  const row = data as { id?: string; title?: string; answer?: string } | null;
  return {
    station: {
      id: String(row?.id ?? id),
      title: String(row?.title ?? ""),
      answer: String(row?.answer ?? ""),
    },
  };
}
