"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  addFolder,
  deleteFolder,
  deleteMaterial,
  updateFolder,
  updateMaterial,
} from "@/lib/actions/materials";
import { setMaterialStatus } from "@/lib/actions/study-content";
import { EntitlementSelect } from "@/components/admin/entitlement-select";
import { StudyPdfUploader } from "@/components/admin/study-pdf-uploader";
import { MaterialOpenLink } from "@/components/study/material-open-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { FolderRow, MaterialRow } from "@/lib/library/folder-tree";

export function CareerCounselingSeriesAdmin({
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

  return (
    <div className="grid gap-6">
      <div className="grid gap-3 rounded-xl border bg-card p-4">
        <p className="text-sm font-medium text-[var(--student-ink)]">
          New folder
        </p>
        <p className="text-xs text-muted-foreground">
          Folders default to free entitlement. PDFs use the protected study-content
          reader (not a public R2 URL). Replace a PDF by uploading a new file, then
          moving the old one to the Bin.
        </p>
        <div className="grid gap-1 sm:max-w-md">
          <Label className="text-xs">Folder name</Label>
          <Input
            placeholder="e.g. USMLE pathway"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="grid gap-1">
          <Label className="text-xs">Description (optional)</Label>
          <Textarea
            placeholder="Short blurb students see on the folder card"
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
                "career_counseling_series",
                "free",
                { description: description.trim() || null }
              );
              if ("error" in created && created.error) {
                toast.error(created.error);
                return;
              }
              setName("");
              setDescription("");
              toast.success("Folder created");
            })
          }
        >
          Create folder
        </Button>
      </div>

      <div className="grid gap-4">
        {folders.map((folder) => (
          <FolderCard
            key={folder.id}
            folder={folder}
            materials={materials.filter(
              (m) => m.folder_id === folder.id && m.kind === "pdf"
            )}
          />
        ))}
        {folders.length === 0 && (
          <div className="rounded-xl border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
            No Career Counseling Series folders for this class yet. Create a
            folder, then upload PDFs.
          </div>
        )}
      </div>
    </div>
  );
}

function FolderCard({
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
  const [open, setOpen] = useState(true);

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
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setOpen((v) => !v)}
              >
                {open ? "Collapse" : "Open folder"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                Edit
              </Button>
            </>
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
                    `Move folder "${folder.name}" to the Bin? Recoverable for ~7 days.`
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
      {open ? (
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              PDFs (protected reader)
            </p>
            {materials.length === 0 ? (
              <p className="text-sm text-muted-foreground">No PDF uploaded yet.</p>
            ) : (
              materials.map((m) => <PdfRow key={m.id} material={m} />)
            )}
            <StudyPdfUploader
              folderId={folder.id}
              onComplete={() => router.refresh()}
            />
          </div>
        </CardContent>
      ) : null}
    </Card>
  );
}

function PdfRow({ material }: { material: MaterialRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [title, setTitle] = useState(material.title);
  const [description, setDescription] = useState(material.description ?? "");

  return (
    <div className="grid gap-3 rounded-md border p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="grid gap-2">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="min-h-14"
                placeholder="Details (optional)"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={pending || !title.trim()}
                  onClick={() =>
                    startTransition(async () => {
                      const { error } = await updateMaterial(material.id, {
                        title,
                        description: description.trim() || null,
                      });
                      if (error) toast.error(error);
                      else {
                        toast.success("PDF details updated");
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
                    setTitle(material.title);
                    setDescription(material.description ?? "");
                    setEditing(false);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <>
              <MaterialOpenLink
                materialId={material.id}
                kind="pdf"
                title={material.title}
                className="h-auto p-0 font-medium"
              />
              {material.description ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {material.description}
                </p>
              ) : null}
              <div className="mt-1 flex flex-wrap gap-1">
                <Badge variant="secondary" className="uppercase">
                  {material.kind}
                </Badge>
                <Badge
                  variant={material.status === "published" ? "default" : "outline"}
                >
                  {material.status}
                </Badge>
              </div>
            </>
          )}
        </div>
        {!editing && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              Edit details
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setReplacing((v) => !v)}
            >
              {replacing ? "Cancel replace" : "Replace PDF"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const next =
                    material.status === "published" ? "draft" : "published";
                  const { error } = await setMaterialStatus(material.id, next);
                  if (error) toast.error(error);
                })
              }
            >
              {material.status === "published" ? "Unpublish" : "Publish"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  if (
                    !window.confirm(
                      `Move “${material.title}” to the Bin? Recoverable for ~7 days.`
                    )
                  ) {
                    return;
                  }
                  const { error } = await deleteMaterial(material.id);
                  if (error) toast.error(error);
                  else toast.success("Moved to Bin");
                })
              }
            >
              Move to Bin
            </Button>
          </div>
        )}
      </div>
      {replacing ? (
        <div className="grid gap-2 border-t pt-3">
          <p className="text-xs text-muted-foreground">
            Upload the replacement PDF into this folder, then move the old file
            above to the Bin when the new upload succeeds.
          </p>
          <StudyPdfUploader
            folderId={material.folder_id}
            onComplete={() => {
              setReplacing(false);
              router.refresh();
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
