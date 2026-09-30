import { notFound } from "next/navigation";
import { McqBankPage } from "@/components/library/mcq-bank-page";
import { MaterialLibraryPage } from "@/components/library/material-library-page";
import { LIBRARY_META, parseLibrarySlug } from "@/lib/library/types";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ type: string }>;
}) {
  const { type } = await params;
  const id = parseLibrarySlug(type);
  return {
    title: id
      ? `Free ${LIBRARY_META[id].label} — MedVerse LMS`
      : "Free Resources",
  };
}

export default async function FreeResourceTypePage({
  params,
}: {
  params: Promise<{ type: string }>;
}) {
  const { type } = await params;
  const id = parseLibrarySlug(type);
  if (!id) notFound();

  if (id === "mcq_bank") return <McqBankPage mode="free" />;
  const meta = LIBRARY_META[id];
  if (!meta.folderType) notFound();
  return <MaterialLibraryPage libraryType={meta.folderType} mode="free" />;
}
