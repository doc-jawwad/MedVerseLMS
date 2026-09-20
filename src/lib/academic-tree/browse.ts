import "server-only";

import { notFound } from "next/navigation";
import {
  findCategoryInSubject,
  findDayFolder,
  findSubjectInTree,
} from "./adapter.ts";
import { findCategoryBySlug, findDaySlotBySlug } from "./product-structure.ts";
import { getAcademicTreePageContext } from "./page-context.ts";
import type {
  AcademicTree,
  AcademicTreeCategory,
  AcademicTreeFolder,
  AcademicTreeSubject,
  AcademicTreeSurface,
  BlockCategoryId,
  TestDaySlotId,
} from "./types.ts";

export type AcademicBrowseContext = Awaited<
  ReturnType<typeof getAcademicTreePageContext>
> & {
  surface: AcademicTreeSurface;
};

export async function loadAcademicBrowse(
  surface: AcademicTreeSurface
): Promise<AcademicBrowseContext> {
  const ctx = await getAcademicTreePageContext(surface);
  return { ...ctx, surface };
}

export function requireBlock(
  tree: AcademicTree,
  blockSlug: string
): AcademicTreeSubject {
  const subject = findSubjectInTree(tree, blockSlug);
  if (!subject) notFound();
  return subject;
}

export function requireCategory(
  subject: AcademicTreeSubject,
  categorySlug: string
): { category: AcademicTreeCategory; categoryId: BlockCategoryId } {
  const def = findCategoryBySlug(categorySlug);
  if (!def) notFound();
  const category = findCategoryInSubject(subject, def.id);
  if (!category) notFound();
  return { category, categoryId: def.id };
}

export function requireProfDay(
  tree: AcademicTree,
  daySlug: string
): AcademicTreeFolder {
  const day = findDayFolder(tree.prof_session.days, daySlug);
  if (!day) notFound();
  return day;
}

export function requireDaySlot(
  day: AcademicTreeFolder,
  slotSlug: string
): { slot: AcademicTreeFolder; slotId: TestDaySlotId } {
  const def = findDaySlotBySlug(slotSlug);
  if (!def) notFound();
  const slot =
    day.children.find((c) => c.day_slot === def.id || c.slug === def.slug) ??
    null;
  if (!slot) notFound();
  return { slot, slotId: def.id };
}
