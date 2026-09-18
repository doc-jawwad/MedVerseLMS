"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  addFolder,
  deleteFolder,
  addMaterial,
  deleteMaterial,
} from "@/lib/actions/materials";
import { OpenMaterialButton } from "@/components/materials/open-material-button";
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
import { Badge } from "@/components/ui/badge";

type Year = { id: string; year_number: number };
type Subject = { id: string; name: string; year_id: string };
type Folder = { id: string; name: string; year_id: string; subject_id: string | null };
type Material = {
  id: string;
  folder_id: string;
  title: string;
  description: string;
  file_type: string;
};

export function MaterialsAdmin({
  years,
  subjects,
  folders,
  materials,
}: {
  years: Year[];
  subjects: Subject[];
  folders: Folder[];
  materials: Material[];
}) {
  const [pending, startTransition] = useTransition();
  const [yearId, setYearId] = useState(years[0]?.id ?? "");
  const [subjectId, setSubjectId] = useState<string>("");
  const [folderName, setFolderName] = useState("");

  const yearSubjects = subjects.filter((s) => s.year_id === yearId);
  const yearFolders = folders.filter((f) => f.year_id === yearId);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end gap-2">
        <div className="grid gap-1">
          <Label className="text-xs">Year</Label>
          <Select value={yearId} onValueChange={(v) => { setYearId(v); setSubjectId(""); }}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y.id} value={y.id}>Year {y.year_number}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
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
              const { error } = await addFolder(yearId, subjectId || null, folderName);
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
          />
        ))}
        {yearFolders.length === 0 && (
          <p className="text-muted-foreground">No folders for this year yet.</p>
        )}
      </div>
    </div>
  );
}

function FolderCard({
  folder,
  subjectName,
  materials,
}: {
  folder: Folder;
  subjectName?: string;
  materials: Material[];
}) {
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [desc, setDesc] = useState("");
  const [type, setType] = useState("pdf");

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">
          {folder.name}{" "}
          {subjectName && <Badge variant="outline">{subjectName}</Badge>}
        </CardTitle>
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              if (!window.confirm(`Delete folder "${folder.name}" and its links?`)) return;
              const { error } = await deleteFolder(folder.id);
              if (error) toast.error(error);
            })
          }
        >
          Delete folder
        </Button>
      </CardHeader>
      <CardContent className="grid gap-3">
        {materials.map((m) => (
          <div
            key={m.id}
            className="flex items-center justify-between rounded-md border p-2 text-sm"
          >
            <div>
              <OpenMaterialButton
                materialId={m.id}
                className="h-auto p-0 font-medium"
              >
                {m.title}
              </OpenMaterialButton>
              <span className="ml-2 text-xs uppercase text-muted-foreground">
                {m.file_type}
              </span>
              {m.description && (
                <p className="text-xs text-muted-foreground">{m.description}</p>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const { error } = await deleteMaterial(m.id);
                  if (error) toast.error(error);
                })
              }
            >
              Remove
            </Button>
          </div>
        ))}

        <div className="flex flex-wrap items-end gap-2 border-t pt-3">
          <Input
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-48"
          />
          <Input
            placeholder="https://drive.google.com/…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="w-72"
          />
          <Input
            placeholder="Description (optional)"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            className="w-56"
          />
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
                const { error } = await addMaterial(folder.id, title, url, desc, type);
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
      </CardContent>
    </Card>
  );
}
