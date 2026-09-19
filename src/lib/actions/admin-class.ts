"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  isYearId,
  writeAdminSelectedYearId,
} from "@/lib/admin/selected-class";

export async function setAdminClassAction(formData: FormData) {
  const yearId = String(formData.get("yearId") ?? "");
  const nextRaw = String(formData.get("next") ?? "/admin/library");
  if (!isYearId(yearId)) {
    redirect("/admin/library");
  }
  await writeAdminSelectedYearId(yearId);
  revalidatePath("/admin");
  const next = nextRaw.startsWith("/admin") ? nextRaw.split("?")[0] : "/admin/library";
  const params = new URLSearchParams();
  params.set("year", yearId);
  redirect(`${next}?${params.toString()}`);
}
