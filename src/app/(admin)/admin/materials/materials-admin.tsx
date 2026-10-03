"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  addFolder,
  deleteFolder,
  addMaterial,
  deleteMaterial,
  moveNotesPdfMaterial,
  updateMaterial,
} from "@/lib/actions/materials";
import {
  addGuidelineMaterial,
  setMaterialStatus,
} from "@/lib/actions/study-content";
import { StudyPdfUploader } from "@/components/admin/study-pdf-uploader";
import { MaterialOpenLink } from "@/components/study/material-open-link";
import { EntitlementSelect } from "@/components/admin/entitlement-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  folderLibraryLabel,
  itemDeliveryModes,
  type FolderLibraryType,
} from "@/lib/library/types";
import { OpenMaterialButton } from "@/components/materials/open-material-button";
import {
  filterNotesPdfMoveDestinations,
  notesPdfMoveDestinationLabel,
  type NotesPdfMoveDestination,
} from "@/lib/admin/notes-pdf-move";

type Year = { id: string; year_number: number; name?: string };
type Subject = { id: string; name: string; year_id: string };
type Folder = {
  id: string;
  name: string;
  year_id: string;
  subject_id: string | null;
  entitlement: string;
  library_type: string;
  content_surface?: string | null;
};
type Material = {
  id: string;
  folder_id: string;
  title: string;
  description: string;
  file_type: string;
  kind: string;
  status: string;
};

export function MaterialsAdmin({
  subjects,
  folders,
  materials,
  lockedYearId,
  libraryType,
  defaultEntitlement = "any_subscription",
}: {
  years: Year[];
  subjects: Subject[];
  folders: Folder[];
  materials: Material[];
  lockedYearId: string;
  libraryType: FolderLibraryType;
  defaultEntitlement?: "free" | "any_subscription";
}) {
  const [pending, startTransition] = useTransition();
  const yearId = lockedYearId;
  const [subjectId, setSubjectId] = useState<string>("");
  const [folderName, setFolderName] = useState("");

  const yearSubjects = subjects.filter((s) => s.year_id === yearId);
  const yearFolders = folders.filter(
    (f) => f.year_id === yearId && f.library_type === libraryType
  );
  const meta = folderLibraryLabel(libraryType);
  const modes = itemDeliveryModes(libraryType);
  const requireSubject =
    libraryType === "notes" ||
    libraryType === "syllabus" ||
    libraryType === "one_liner";

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end gap-2 rounded-xl border bg-card p-4">
        <div className="grid gap-1">
          <Label className="text-xs">
            {requireSubject ? "Subject (required)" : "Subject (optional)"}
          </Label>
          <Select
            value={subjectId || "none"}
            onValueChange={(v) => setSubjectId(v === "none" ? "" : v)}
          >
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              {!requireSubject ? (
                <SelectItem value="none">— General —</SelectItem>
              ) : null}
              {yearSubjects.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Input
          placeholder="New folder name…"
          value={folderName}
          onChange={(e) => setFolderName(e.target.value)}
          className="w-64"
        />
        <Button
          disabled={
            pending ||
            !folderName.trim() ||
            !yearId ||
            (requireSubject && !subjectId)
          }
          onClick={() =>
            startTransition(async () => {
              if (requireSubject && !subjectId) {
                toast.error(
                  "Subject is required for Notes, Syllabus, and One Liner."
                );
                return;
              }
              const result = await addFolder(
                yearId,
                subjectId || null,
                folderName,
                libraryType,
                defaultEntitlement
              );
              if ("error" in result && result.error) toast.error(result.error);
              else setFolderName("");
            })
          }
        >
          Add folder
        </Button>
      </div>

      <div className="grid gap-4">
        {yearFolders.map((f) => (
          <FolderCard
            key={f.id}
            folder={f}
            libraryType={libraryType}
            subjectName={subjects.find((s) => s.id === f.subject_id)?.name}
            materials={materials.filter((m) => m.folder_id === f.id)}
            moveDestinations={
              libraryType === "notes"
                ? filterNotesPdfMoveDestinations(
                    yearFolders.map(
                      (d): NotesPdfMoveDestination => ({
                        id: d.id,
                        name: d.name,
                        year_id: d.year_id,
                        library_type: d.library_type,
                        content_surface: d.content_surface || "academic",
                        subject_id: d.subject_id,
                      })
                    ),
                    {
                      sourceFolderId: f.id,
                      yearId: yearId,
                      contentSurface: f.content_surface || "academic",
                    }
                  )
                : []
            }
            modes={modes}
            linkLabel={
              libraryType === "lectures" || libraryType === "ospe_lectures"
                ? "YouTube or Drive link"
                : "Drive link"
            }
          />
        ))}
        {yearFolders.length === 0 && (
          <div className="rounded-xl border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
            No {meta.label.toLowerCase()} folders for this class yet. Create a folder for a subject/topic, then add items.
          </div>
        )}
      </div>
    </div>
  );
}

function FolderCard({
  folder,
  libraryType,
  subjectName,
  materials,
  moveDestinations,
  modes,
  linkLabel,
}: {
  folder: Folder;
  libraryType: FolderLibraryType;
  subjectName?: string;
  materials: Material[];
  moveDestinations: NotesPdfMoveDestination[];
  modes: Array<"pdf" | "guideline" | "drive">;
  linkLabel: string;
}) {
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<"drive" | "pdf" | "guideline">(modes[0] ?? "pdf");

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <CardTitle className="text-base">
          {folder.name}{" "}
          {subjectName && <Badge variant="outline">{subjectName}</Badge>}
        </CardTitle>
        <div className="flex flex-wrap items-center gap-2">
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
                    `Move folder "${folder.name}" to the Bin? Items stay recoverable for ~7 days (until about ${new Date(Date.now() + 7 * 864e5).toLocaleDateString()}). This does not permanently delete.`
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
      <CardContent className="grid gap-3">
        {materials.length === 0 && (
          <p className="text-sm text-muted-foreground">Nothing in this folder yet.</p>
        )}
        {materials.map((m) => (
          <MaterialRow
            key={m.id}
            material={m}
            libraryType={libraryType}
            moveDestinations={moveDestinations}
          />
        ))}

        <div className="flex flex-wrap gap-2 border-t pt-3">
          {modes.map((k) => (
            <Button
              key={k}
              type="button"
              size="sm"
              variant={mode === k ? "default" : "outline"}
              onClick={() => setMode(k)}
            >
              {k === "pdf" ? "PDF" : k === "guideline" ? "Guideline" : linkLabel}
            </Button>
          ))}
        </div>
        {mode === "drive" && <DriveForm folderId={folder.id} />}
        {mode === "pdf" && <PdfForm folderId={folder.id} />}
        {mode === "guideline" && <GuidelineForm folderId={folder.id} />}
      </CardContent>
    </Card>
  );
}

function MaterialRow({
  material,
  libraryType,
  moveDestinations,
}: {
  material: Material;
  libraryType: FolderLibraryType;
  moveDestinations: NotesPdfMoveDestination[];
}) {
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [moving, setMoving] = useState(false);
  const [destFolderId, setDestFolderId] = useState("");
  const [title, setTitle] = useState(material.title);
  const [description, setDescription] = useState(material.description ?? "");
  const canMoveNotesPdf =
    libraryType === "notes" && material.kind === "pdf" && moveDestinations.length > 0;

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
                        toast.success("Details updated");
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
              {material.kind === "drive" ? (
                <OpenMaterialButton materialId={material.id} className="h-auto p-0 font-medium">
                  {material.title}
                </OpenMaterialButton>
              ) : (
                <MaterialOpenLink
                  materialId={material.id}
                  kind={material.kind}
                  title={material.title}
                />
              )}
              <div className="mt-1 flex flex-wrap gap-1">
                <Badge variant="secondary" className="uppercase">{material.kind}</Badge>
                <Badge variant={material.status === "published" ? "default" : "outline"}>
                  {material.status}
                </Badge>
              </div>
              {material.description ? (
                <p className="text-xs text-muted-foreground">{material.description}</p>
              ) : null}
            </>
          )}
        </div>
        {!editing ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              Edit details
            </Button>
            {canMoveNotesPdf ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setMoving((v) => !v);
                  setReplacing(false);
                }}
              >
                {moving ? "Cancel move" : "Move"}
              </Button>
            ) : null}
            {material.kind === "pdf" ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setReplacing((v) => !v);
                  setMoving(false);
                }}
              >
                {replacing ? "Cancel replace" : "Replace PDF"}
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const next = material.status === "published" ? "draft" : "published";
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
                      `Move “${material.title}” to the Bin? Recoverable for ~7 days. R2 files are kept until permanent purge.`
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
        ) : null}
      </div>
      {moving && canMoveNotesPdf ? (
        <div className="grid gap-2 border-t pt-3">
          <p className="text-xs text-muted-foreground">
            Move this PDF to another Notes folder. The file stays in place — only
            the folder assignment changes.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="grid gap-1">
              <Label className="text-xs">Destination folder</Label>
              <Select
                value={destFolderId || undefined}
                onValueChange={setDestFolderId}
              >
                <SelectTrigger className="w-64">
                  <SelectValue placeholder="Choose folder…" />
                </SelectTrigger>
                <SelectContent>
                  {moveDestinations.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {notesPdfMoveDestinationLabel(d)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              size="sm"
              disabled={pending || !destFolderId}
              onClick={() =>
                startTransition(async () => {
                  const res = await moveNotesPdfMaterial({
                    materialId: material.id,
                    destFolderId,
                    sourceFolderId: material.folder_id,
                  });
                  if ("error" in res && res.error) toast.error(res.error);
                  else {
                    toast.success("Moved to folder");
                    setMoving(false);
                    setDestFolderId("");
                  }
                })
              }
            >
              Confirm move
            </Button>
          </div>
        </div>
      ) : null}
      {replacing && material.kind === "pdf" ? (
        <div className="grid gap-2 border-t pt-3">
          <p className="text-xs text-muted-foreground">
            Upload the replacement PDF into this folder, then move the old file
            above to the Bin when the new upload succeeds.
          </p>
          <StudyPdfUploader
            folderId={material.folder_id}
            onComplete={() => setReplacing(false)}
          />
        </div>
      ) : null}
    </div>
  );
}

function DriveForm({ folderId }: { folderId: string }) {
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [desc, setDesc] = useState("");
  const [type, setType] = useState("pdf");
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} className="w-48" />
      <Input placeholder="https://youtube.com/… or https://drive.google.com/…" value={url} onChange={(e) => setUrl(e.target.value)} className="w-72" />
      <Input placeholder="Description (optional)" value={desc} onChange={(e) => setDesc(e.target.value)} className="w-56" />
      <Select value={type} onValueChange={setType}>
        <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
        <SelectContent>
          {["pdf", "video", "notes", "slides", "other"].map((t) => (
            <SelectItem key={t} value={t}>{t}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        size="sm"
        disabled={pending || !title.trim() || !url.trim()}
        onClick={() =>
          startTransition(async () => {
            const { error } = await addMaterial(folderId, title, url, desc, type);
            if (error) toast.error(error);
            else {
              setTitle("");
              setUrl("");
              setDesc("");
            }
          })
        }
      >
        Add link
      </Button>
    </div>
  );
}

function PdfForm({ folderId }: { folderId: string }) {
  return <StudyPdfUploader folderId={folderId} />;
}

function GuidelineForm({ folderId }: { folderId: string }) {
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [body, setBody] = useState("");
  const [reference, setReference] = useState("");
  const [publish, setPublish] = useState(true);
  return (
    <div className="grid gap-2">
      <Input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <Input placeholder="Description (optional)" value={desc} onChange={(e) => setDesc(e.target.value)} />
      <Input placeholder="Book / reference (optional)" value={reference} onChange={(e) => setReference(e.target.value)} />
      <Textarea
        placeholder="Write the study guideline. Use headings (#), lists (-), and **bold**."
        value={body}
        onChange={(e) => setBody(e.target.value)}
        className="min-h-40"
      />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} />
        Publish now
      </label>
      <Button
        size="sm"
        className="w-fit"
        disabled={pending || !title.trim() || !body.trim()}
        onClick={() =>
          startTransition(async () => {
            const { error } = await addGuidelineMaterial({
              folderId,
              title,
              description: desc,
              bodyText: body,
              referenceText: reference,
              publish,
            });
            if (error) toast.error(error);
            else {
              toast.success("Guideline saved");
              setTitle("");
              setDesc("");
              setBody("");
              setReference("");
            }
          })
        }
      >
        Add guideline
      </Button>
    </div>
  );
}
