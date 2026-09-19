"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  addFolder,
  deleteFolder,
  addMaterial,
  deleteMaterial,
} from "@/lib/actions/materials";
import {
  addGuidelineMaterial,
  addPdfMaterial,
  setMaterialStatus,
} from "@/lib/actions/study-content";
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
  itemDeliveryModes,
  LIBRARY_META,
  type FolderLibraryType,
} from "@/lib/library/types";
import { OpenMaterialButton } from "@/components/materials/open-material-button";

type Year = { id: string; year_number: number; name?: string };
type Subject = { id: string; name: string; year_id: string };
type Folder = {
  id: string;
  name: string;
  year_id: string;
  subject_id: string | null;
  entitlement: string;
  library_type: string;
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
  const meta = LIBRARY_META[libraryType];
  const modes = itemDeliveryModes(libraryType);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end gap-2 rounded-xl border bg-card p-4">
        <div className="grid gap-1">
          <Label className="text-xs">Subject (optional)</Label>
          <Select
            value={subjectId || "none"}
            onValueChange={(v) => setSubjectId(v === "none" ? "" : v)}
          >
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— General —</SelectItem>
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
          disabled={pending || !folderName.trim() || !yearId}
          onClick={() =>
            startTransition(async () => {
              const { error } = await addFolder(
                yearId,
                subjectId || null,
                folderName,
                libraryType,
                defaultEntitlement
              );
              if (error) toast.error(error);
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
            subjectName={subjects.find((s) => s.id === f.subject_id)?.name}
            materials={materials.filter((m) => m.folder_id === f.id)}
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
  subjectName,
  materials,
  modes,
  linkLabel,
}: {
  folder: Folder;
  subjectName?: string;
  materials: Material[];
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
                if (!window.confirm(`Delete folder "${folder.name}" and its items?`)) return;
                const { error } = await deleteFolder(folder.id);
                if (error) toast.error(error);
              })
            }
          >
            Delete folder
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        {materials.length === 0 && (
          <p className="text-sm text-muted-foreground">Nothing in this folder yet.</p>
        )}
        {materials.map((m) => (
          <MaterialRow key={m.id} material={m} />
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

function MaterialRow({ material }: { material: Material }) {
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm">
      <div className="min-w-0">
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
        {material.description && (
          <p className="text-xs text-muted-foreground">{material.description}</p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
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
              if (!window.confirm(`Remove “${material.title}”?`)) return;
              const { error } = await deleteMaterial(material.id);
              if (error) toast.error(error);
            })
          }
        >
          Remove
        </Button>
      </div>
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
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="grid gap-2 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const data = new FormData(form);
        data.set("folderId", folderId);
        startTransition(async () => {
          const { error } = await addPdfMaterial(data);
          if (error) toast.error(error);
          else {
            toast.success("PDF saved");
            form.reset();
          }
        });
      }}
    >
      <Input name="title" required placeholder="Title" />
      <Input name="description" placeholder="Description (optional)" />
      <div className="grid gap-1 text-sm">
        <Label>PDF file</Label>
        <Input name="file" type="file" accept="application/pdf" required />
      </div>
      <div className="grid gap-1 text-sm">
        <Label>Cover (optional)</Label>
        <Input name="cover" type="file" accept="image/jpeg,image/png,image/webp" />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="publish" value="1" defaultChecked />
        Publish now
      </label>
      <Button type="submit" size="sm" disabled={pending} className="w-fit">
        {pending ? "Uploading…" : "Add PDF"}
      </Button>
    </form>
  );
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
