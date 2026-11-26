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
import { validateOspeBulkItem, matchesOspeBulkReplay } from "@/lib/admin/ospe-bulk";

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

// Distinguish an explicit statement rejection from losing its response.
function isDefinitiveDbRejection(error: { code?: string }): boolean {
  return /^(22|23|42)[0-9A-Z]{3}$/.test(error.code ?? "");
}

export type OspeStationInput = {
  title: string;
  answer: string;
  yearId: string;
  subjectId: string;
  status?: "draft" | "published";
  sortOrder?: number;
};

async function createOspeStationRecord(formData: FormData, requestId?: string): Promise<{ id: string } | { error: string }> {
  const selectedYearId = await readAdminSelectedYearId();
  if (!selectedYearId) {
    return { error: "Select a class before creating an OSPE station." };
  }

  const title = String(formData.get("title") ?? "").trim();
  const answer = String(formData.get("answer") ?? "").trim();
  const subjectId = String(formData.get("subjectId") ?? "");
  const status =
    !requestId && String(formData.get("status") ?? "draft") === "published"
      ? "published"
      : "draft";
  const parsedSortOrder = Number(formData.get("sortOrder") ?? 0);
  const sortOrder = requestId ? parsedSortOrder : parsedSortOrder || 0;
  const file = formData.get("image");

  if (!title || !answer || !subjectId) {
    return { error: "Title, answer, and subject are required." };
  }
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a station image (JPEG, PNG, or WebP)." };
  }
  const imageErr = isOspeStationImageFile(file);
  if (imageErr) return { error: imageErr };

  if (requestId) {
    const validation = validateOspeBulkItem({ requestId, title, answer, sortOrder });
    if (validation) return { error: validation };
    if (String(formData.get("yearId") ?? "") !== selectedYearId) {
      return { error: "Selected class changed. Reopen the bulk import for the correct class." };
    }
  }
  const supabase = await createClient();
  const { data: subject } = await supabase
    .from("subjects")
    .select("year_id")
    .eq("id", subjectId)
    .maybeSingle();
  if (!subject || subject.year_id !== selectedYearId) {
    return { error: "Subject must belong to the selected class." };
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (requestId) {
    if (!user) return { error: "Sign in again before retrying the batch." };
    const [permission, classAccess] = await Promise.all([
      supabase.rpc("has_permission", { p_code: "manage_materials" }),
      supabase.rpc("admin_can_access_year", { p_year_id: selectedYearId }),
    ]);
    if (permission.error || permission.data !== true || classAccess.error || classAccess.data !== true) {
      return { error: "You cannot create OSPE stations in the selected class." };
    }
    const prior = await supabase.rpc("get_ospe_station_for_admin", { p_station_id: requestId });
    if (prior.data) {
      const active = await supabase.from("ospe_stations").select("id").eq("id", requestId)
        .is("deleted_at", null).maybeSingle();
      if (!active.error && active.data && matchesOspeBulkReplay(prior.data, {
        requestId, userId: user.id, yearId: selectedYearId, subjectId, title, answer,
        sortOrder, contentType: file.type, byteSize: file.size,
      })) return { id: requestId };
      return { error: "This import ID already exists with different details. Check the station list." };
    }
    if (prior.error?.message !== "ospe_not_found") {
      return { error: "Could not verify this import ID. Retry the same row after checking access." };
    }
  }
  const allocated = await allocateStudyObjectKey();
  if ("error" in allocated && allocated.error) return { error: allocated.error };
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

  const { data, error } = await supabase
    .from("ospe_stations")
    .insert({
      ...(requestId ? { id: requestId } : {}),
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
    // Do not delete a possibly committed image after an ambiguous response.
    const rejected = isDefinitiveDbRejection(error);
    if (rejected) await discardStudyKey(supabase, key);
    return { error: requestId
      ? "Station save not confirmed. Retry this same row to reconcile its import ID."
      : rejected
        ? toClientActionError(error, "createOspeStation.insert")
        : "Station save not confirmed. Check the station list before retrying." };
  }
  if (!data?.id || (requestId && data.id !== requestId)) {
    return { error: "Station save not confirmed. Check the station list before retrying." };
  }
  revalidateOspe();
  return { id: data.id };
}
export async function createOspeStation(formData: FormData) {
  const result = await createOspeStationRecord(formData);
  if ("error" in result) return result;
  redirect(`/admin/ospe-stations/${result.id}`);
}
export async function createOspeStationDraft(formData: FormData) {
  const requestId = String(formData.get("requestId") ?? "");
  if (!requestId) return { error: "Missing import ID." };
  return createOspeStationRecord(formData, requestId);
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
  const [subject, classAccess] = await Promise.all([
    supabase.from("subjects").select("year_id").eq("id", subjectId).maybeSingle(),
    supabase.rpc("admin_can_access_year", { p_year_id: yearId }),
  ]);
  if (subject.error || subject.data?.year_id !== yearId || classAccess.error || classAccess.data !== true) {
    return { error: "Subject must belong to a class you can manage." };
  }

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

  const { data: saved, error } = await supabase
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
    .eq("id", id)
    .select("id,r2_object_key")
    .maybeSingle();

  if (error) {
    const rejected = isDefinitiveDbRejection(error);
    if (rejected && previousKey && nextKey !== previousKey) {
      await discardStudyKey(supabase, nextKey);
    }
    return { error: rejected
      ? toClientActionError(error, "updateOspeStation")
      : "Station update not confirmed. Reload the station before retrying." };
  }

  // Do not discard either image or claim success without row confirmation.
  if (saved?.id !== id || saved.r2_object_key !== nextKey) {
    return { error: "Station update not confirmed. Reload the station before retrying." };
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
