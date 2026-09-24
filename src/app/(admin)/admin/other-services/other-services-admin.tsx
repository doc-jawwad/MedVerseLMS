"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  addFolder,
  addMaterial,
  deleteFolder,
  deleteMaterial,
  updateFolder,
} from "@/lib/actions/materials";
import { EntitlementSelect } from "@/components/admin/entitlement-select";
import { StudyPdfUploader } from "@/components/admin/study-pdf-uploader";
import { OpenMaterialButton } from "@/components/materials/open-material-button";
import { MaterialOpenLink } from "@/components/study/material-open-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { FolderRow, MaterialRow } from "@/lib/library/folder-tree";

export function OtherServicesAdmin({
  yearId,
  folders,
  materials,
}: {
  yearId: string;
  folders: FolderRow[];
  materials: MaterialRow[];
}) {
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [driveUrl, setDriveUrl] = useState("");

  return (
    <div className="grid gap-6">
      <div className="grid gap-3 rounded-xl border bg-card p-4">
        <p className="text-sm font-medium text-[var(--student-ink)]">
          New service
        </p>
        <p className="text-xs text-muted-foreground">
          Services default to free entitlement so students can open them without a
          paid subscription. Change entitlement per service if needed. PDFs use the
          protected study-content reader (not a public R2 URL).
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="grid gap-1">
            <Label className="text-xs">Title</Label>
            <Input
              placeholder="Service name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Drive URL (optional)</Label>
            <Input
              placeholder="https://drive.google.com/…"
              value={driveUrl}
              onChange={(e) => setDriveUrl(e.target.value)}
            />
          </div>
        </div>
        <div className="grid gap-1">
          <Label className="text-xs">Description (optional)</Label>
          <Textarea
            placeholder="Short blurb students see on the card"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="min-h-20"
          />
        </div>
        <Button
          className="w-fit"
          disabled={pending || !name.trim()}
          onClick={() =>
            startTransition(async () => {
              const created = await addFolder(
                yearId,
                null,
                name,
                "other_services",
                "free",
                { description: description.trim() || null }
              );
              if ("error" in created && created.error) {
                toast.error(created.error);
                return;
              }
              const folderId =
                "id" in created && typeof created.id === "string"
                  ? created.id
                  : null;
              if (folderId && driveUrl.trim()) {
                const { error } = await addMaterial(
                  folderId,
                  name.trim(),
                  driveUrl.trim(),
                  "",
                  "other"
                );
                if (error) {
                  toast.error(error);
                  return;
                }
              }
              setName("");
              setDescription("");
              setDriveUrl("");
              toast.success("Service created");
            })
          }
        >
          Create service
        </Button>
      </div>

      <div className="grid gap-4">
        {folders.map((folder) => (
          <ServiceCard
            key={folder.id}
            folder={folder}
            materials={materials.filter((m) => m.folder_id === folder.id)}
          />
        ))}
        {folders.length === 0 && (
          <div className="rounded-xl border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
            No other services for this class yet. Create a service, then upload a
            PDF or add a Drive link.
          </div>
        )}
      </div>
    </div>
  );
}

function ServiceCard({
  folder,
  materials,
}: {
  folder: FolderRow;
  materials: MaterialRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(folder.name);
  const [description, setDescription] = useState(folder.description ?? "");
  const [linkTitle, setLinkTitle] = useState(folder.name);
  const [linkUrl, setLinkUrl] = useState("");

  const pdfs = materials.filter((m) => m.kind === "pdf");
  const drives = materials.filter((m) => m.kind === "drive");

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="grid gap-2">
              <Input value={name} onChange={(e) => setName(e.target.value)} />
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="min-h-16"
                placeholder="Description (optional)"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={pending || !name.trim()}
                  onClick={() =>
                    startTransition(async () => {
                      const { error } = await updateFolder(folder.id, {
                        name,
                        description: description.trim() || null,
                      });
                      if (error) toast.error(error);
                      else {
                        toast.success("Updated");
                        setEditing(false);
                      }
                    })
                  }
                >
                  Save
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setName(folder.name);
                    setDescription(folder.description ?? "");
                    setEditing(false);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <>
              <CardTitle className="text-base">{folder.name}</CardTitle>
              {folder.description ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  {folder.description}
                </p>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">
                  No description
                </p>
              )}
            </>
          )}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {!editing && (
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              Edit
            </Button>
          )}
          <EntitlementSelect
            kind="materials_folder"
            id={folder.id}
            value={folder.entitlement}
          />
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                if (
                  !window.confirm(
                    `Move service "${folder.name}" to the Bin? Recoverable for ~7 days.`
                  )
                ) {
                  return;
                }
                const { error } = await deleteFolder(folder.id);
                if (error) toast.error(error);
                else toast.success("Moved to Bin");
              })
            }
          >
            Move to Bin
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-2">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            PDFs (protected reader)
          </p>
          {pdfs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No PDF uploaded yet.</p>
          ) : (
            pdfs.map((m) => (
              <div
                key={m.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
              >
                <div className="min-w-0">
                  <MaterialOpenLink
                    materialId={m.id}
                    kind="pdf"
                    title={m.title}
                    className="h-auto p-0 font-medium"
                  />
                  <div className="mt-1 flex flex-wrap gap-1">
                    <Badge variant="secondary" className="uppercase">
                      {m.kind}
                    </Badge>
                    <Badge
                      variant={m.status === "published" ? "default" : "outline"}
                    >
                      {m.status}
                    </Badge>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      if (
                        !window.confirm(
                          `Move “${m.title}” to the Bin? Recoverable for ~7 days.`
                        )
                      ) {
                        return;
                      }
                      const { error } = await deleteMaterial(m.id);
                      if (error) toast.error(error);
                      else toast.success("Moved to Bin");
                    })
                  }
                >
                  Move to Bin
                </Button>
              </div>
            ))
          )}
          <StudyPdfUploader
            folderId={folder.id}
            onComplete={() => router.refresh()}
          />
        </div>

        <div className="grid gap-2 border-t pt-3">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Drive links
          </p>
          {drives.length === 0 && (
            <p className="text-sm text-muted-foreground">No Drive link yet.</p>
          )}
          {drives.map((m) => (
            <div
              key={m.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
            >
              <div className="min-w-0">
                <OpenMaterialButton
                  materialId={m.id}
                  className="h-auto p-0 font-medium"
                >
                  {m.title}
                </OpenMaterialButton>
                <div className="mt-1">
                  <Badge variant="secondary" className="uppercase">
                    {m.kind}
                  </Badge>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    if (
                      !window.confirm(
                        `Move “${m.title}” to the Bin? Recoverable for ~7 days.`
                      )
                    ) {
                      return;
                    }
                    const { error } = await deleteMaterial(m.id);
                    if (error) toast.error(error);
                    else toast.success("Moved to Bin");
                  })
                }
              >
                Move to Bin
              </Button>
            </div>
          ))}

          <div className="flex flex-wrap items-end gap-2">
            <Input
              placeholder="Link title"
              value={linkTitle}
              onChange={(e) => setLinkTitle(e.target.value)}
              className="w-40"
            />
            <Input
              placeholder="https://drive.google.com/…"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              className="w-72"
            />
            <Button
              size="sm"
              disabled={pending || !linkTitle.trim() || !linkUrl.trim()}
              onClick={() =>
                startTransition(async () => {
                  const { error } = await addMaterial(
                    folder.id,
                    linkTitle,
                    linkUrl,
                    "",
                    "other"
                  );
                  if (error) toast.error(error);
                  else {
                    setLinkUrl("");
                    toast.success("Link added");
                  }
                })
              }
            >
              Add Drive link
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
