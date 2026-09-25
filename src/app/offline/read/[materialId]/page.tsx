"use client";

import { use } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { getOfflineMeta } from "@/lib/study/offline-pdf-store";
import { useEffect, useState } from "react";

const PdfViewer = dynamic(
  () =>
    import("@/components/study/pdf-viewer").then((m) => ({
      default: m.PdfViewer,
    })),
  {
    ssr: false,
    loading: () => (
      <p className="text-sm text-muted-foreground">Loading PDF reader…</p>
    ),
  }
);

export default function OfflineReadPage({
  params,
}: {
  params: Promise<{ materialId: string }>;
}) {
  const { materialId } = use(params);
  const [title, setTitle] = useState("Offline PDF");

  useEffect(() => {
    void getOfflineMeta(materialId).then((m) => {
      if (m?.title) setTitle(m.title);
    });
  }, [materialId]);

  return (
    <div className="grid gap-3" data-testid="offline-reader-page">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        <Link
          href="/offline"
          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          Offline Library
        </Link>
      </div>
      <PdfViewer
        materialId={materialId}
        title={title}
        preferOfflineDefault
      />
    </div>
  );
}
