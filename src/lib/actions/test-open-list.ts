"use server";

import { revalidatePath } from "next/cache";
import { actionRpcResult } from "@/lib/errors/safe-action-error";
import { createClient } from "@/lib/supabase/server";

function revalidateOpenList() {
  revalidatePath("/admin/tests");
  revalidatePath("/admin/tests/open-list");
  revalidatePath("/dashboard");
}

export async function createTestOpenListGroup(yearId: string, name: string) {
  if (!yearId) return { error: "Class year required.", id: null as string | null };
  const trimmed = name.trim();
  if (!trimmed) return { error: "Group name required.", id: null as string | null };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_create_test_open_list_group", {
    p_year_id: yearId,
    p_name: trimmed,
  });
  revalidateOpenList();
  if (error) {
    const result = actionRpcResult("createTestOpenListGroup", error);
    return { error: result.error, id: null as string | null };
  }
  return { id: typeof data === "string" ? data : null, error: undefined };
}

export async function renameTestOpenListGroup(groupId: string, name: string) {
  if (!groupId) return { error: "Group required." };
  const trimmed = name.trim();
  if (!trimmed) return { error: "Group name required." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_rename_test_open_list_group", {
    p_group_id: groupId,
    p_name: trimmed,
  });
  revalidateOpenList();
  return actionRpcResult("renameTestOpenListGroup", error);
}

export async function deleteTestOpenListGroup(groupId: string) {
  if (!groupId) return { error: "Group required." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_delete_test_open_list_group", {
    p_group_id: groupId,
  });
  revalidateOpenList();
  return actionRpcResult("deleteTestOpenListGroup", error);
}

export async function reorderTestOpenListGroups(
  yearId: string,
  orderedIds: string[]
) {
  if (!yearId || orderedIds.length === 0) {
    return { error: "Reorder requires a year and group list." };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_reorder_test_open_list_groups", {
    p_year_id: yearId,
    p_ordered_ids: orderedIds,
  });
  revalidateOpenList();
  return actionRpcResult("reorderTestOpenListGroups", error);
}

export async function assignTestOpenListPlacement(
  testId: string,
  groupId: string | null
) {
  if (!testId) return { error: "Test required." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_assign_test_open_list_placement", {
    p_test_id: testId,
    p_group_id: groupId,
  });
  revalidateOpenList();
  return actionRpcResult("assignTestOpenListPlacement", error);
}

export async function reorderTestOpenListPlacements(
  yearId: string,
  groupId: string | null,
  orderedTestIds: string[]
) {
  if (!yearId || orderedTestIds.length === 0) {
    return { error: "Reorder requires a year and test list." };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc(
    "admin_reorder_test_open_list_placements",
    {
      p_year_id: yearId,
      p_group_id: groupId,
      p_ordered_test_ids: orderedTestIds,
    }
  );
  revalidateOpenList();
  return actionRpcResult("reorderTestOpenListPlacements", error);
}
