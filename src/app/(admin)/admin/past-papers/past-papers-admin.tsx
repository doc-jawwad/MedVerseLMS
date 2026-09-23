"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  addFolder,
  deleteFolder,
  deleteMaterial,
  reorderFolders,
  updateFolder,
} from "@/lib/actions/materials";
import {
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
  nestFolders,
  type FolderRow,
  type MaterialRow,
} from "@/lib/library/folder-tree";

export function PastPapersAdmin({
  yearId,
  folders,
  materials,
}: {
  yearId: string;
  folders: FolderRow[];
  materials: MaterialRow[];
}) {
  const [pending, startTransition] = useTransition();
  const [subNavName, setSubNavName] = useState("");
  const [parentId, setParentId] = useState("");
  const [subSubName, setSubSubName] = useState("");

  const tree = useMemo(
    () => nestFolders(folders, materials, "past_papers"),
    [folders, materials]
  );
  const roots = tree;

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end gap-2 rounded-xl border bg-card p-4">
        <div className="grid gap-1">
          <Label className="text-xs">New Sub Nav</Label>
          <Input
            placeholder="e.g. Midterms"
            value={subNavName}
            onChange={(e) => setSubNavName(e.target.value)}
            className="w-56"
          />
        </div>
        <Button
          disabled={pending || !subNavName.trim()}
          onClick={() =>
            startTransition(async () => {
              const result = await addFolder(
                yearId,
                null,
                subNavName,
                "past_papers",
                "any_subscription",
                {}
              );
              if ("error" in result && result.error) toast.error(result.error);
              else setSubNavName("");
            })
          }
        >
          Create Sub Nav
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-xl border bg-card p-4">
        <div className="grid gap-1">
          <Label className="text-xs">Parent Sub Nav</Label>
          <select
            className="h-9 w-56 rounded-md border bg-background px-3 text-sm"
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
          >
            <option value="">— Select —</option>
            {roots.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1">
          <Label className="text-xs">New Sub-Sub</Label>
          <Input
            placeholder="e.g. 2024 papers"
            value={subSubName}
            onChange={(e) => setSubSubName(e.target.value)}
            className="w-56"
          />
        </div>
        <Button
          disabled={pending || !parentId || !subSubName.trim()}
          onClick={() =>
            startTransition(async () => {
              const result = await addFolder(
                yearId,
                null,
                subSubName,
                "past_papers",
                "any_subscription",
                { parentId }
              );
              if ("error" in result && result.error) toast.error(result.error);
              else setSubSubName("");
            })
          }
        >
          Create Sub-Sub
        </Button>
      </div>

      <div className="grid gap-4">
        {roots.map((node, index) => (
          <SubNavCard
            key={node.id}
            node={node}
            siblingIds={roots.map((r) => r.id)}
            index={index}
          />
        ))}
        {roots.length === 0 && (
          <div className="rounded-xl border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
            No Past Papers Sub Navs for this class yet. Create a Sub Nav, then add
            Sub-Subs and PDFs.
          </div>
        )}
      </div>
    </div>
  );
}

function SubNavCard({
  node,
  siblingIds,
  index,
}: {
  node: ReturnType<typeof nestFolders>[number];
  siblingIds: string[];
  index: number;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <CardTitle className="text-base">{node.name}</CardTitle>
          <p className="text-xs text-muted-foreground">Sub Nav</p>
        </div>
        <FolderToolbar
          folder={node}
          siblingIds={siblingIds}
          index={index}
        />
      </CardHeader>
      <CardContent className="grid gap-4">
        <MaterialList materials={node.materials} />
        <PdfForm folderId={node.id} />

        {node.children.length > 0 && (
          <div className="grid gap-3 border-t pt-4">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Sub-Sub Navs
            </p>
            {node.children.map((child, childIndex) => (
              <div
                key={child.id}
                className="rounded-xl border bg-muted/20 p-4"
              >
                <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="font-medium text-sm text-[var(--student-ink)]">
                      {child.name}
                    </p>
                    <p className="text-xs text-muted-foreground">Sub-Sub</p>
                  </div>
                  <FolderToolbar
                    folder={child}
                    siblingIds={node.children.map((c) => c.id)}
                    index={childIndex}
                    compact
                  />
                </div>
                <div className="grid gap-3">
                  <MaterialList materials={child.materials} />
                  <PdfForm folderId={child.id} />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FolderToolbar({
  folder,
  siblingIds,
  index,
  compact,
}: {
  folder: { id: string; name: string; entitlement: string };
  siblingIds: string[];
  index: number;
  compact?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(folder.name);

  return (
    <div className={`flex flex-wrap items-end gap-2${compact ? " justify-end" : ""}`}>
      {renaming ? (
        <>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-44"
          />
          <Button
            size="sm"
            disabled={pending || !name.trim()}
            onClick={() =>
              startTransition(async () => {
                const { error } = await updateFolder(folder.id, { name });
                if (error) toast.error(error);
                else {
                  toast.success("Renamed");
                  setRenaming(false);
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
              setRenaming(false);
            }}
          >
            Cancel
          </Button>
        </>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setRenaming(true)}>
          Rename
        </Button>
      )}
      <Button
        size="sm"
        variant="outline"
        disabled={pending || index === 0}
        onClick={() =>
          startTransition(async () => {
            if (index === 0) return;
            const next = [...siblingIds];
            const prev = next[index - 1];
            next[index - 1] = next[index];
            next[index] = prev;
            const { error } = await reorderFolders(next);
            if (error) toast.error(error);
          })
        }
      >
        Move up
      </Button>
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
  );
}

function MaterialList({ materials }: { materials: MaterialRow[] }) {
  if (materials.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No PDFs in this folder yet.</p>
    );
  }
  return (
    <div className="grid gap-2">
      {materials.map((m) => (
        <MaterialRow key={m.id} material={m} />
      ))}
    </div>
  );
}

function MaterialRow({ material }: { material: MaterialRow }) {
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm">
      <div className="min-w-0">
        <MaterialOpenLink
          materialId={material.id}
          kind={material.kind}
          title={material.title}
        />
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
        <Label>PDF file (max 25MB)</Label>
        <Input name="file" type="file" accept="application/pdf" required />
      </div>
      <div className="grid gap-1 text-sm">
        <Label>Cover (optional)</Label>
        <Input
          name="cover"
          type="file"
          accept="image/jpeg,image/png,image/webp"
        />
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
