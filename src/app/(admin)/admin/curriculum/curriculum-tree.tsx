"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  addCurriculumNode,
  renameCurriculumNode,
  deleteCurriculumNode,
  type CurriculumKind,
} from "@/lib/actions/curriculum";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type TopicNode = { id: string; name: string };
export type ChapterNode = { id: string; name: string; topics: TopicNode[] };
export type BookNode = { id: string; name: string; chapters: ChapterNode[] };
export type SubjectNode = { id: string; name: string; books: BookNode[] };

const childKind: Record<string, CurriculumKind> = {
  year: "subjects",
  subject: "books",
  chapter: "topics",
  book: "chapters",
};
const childLabel: Record<string, string> = {
  year: "subject",
  subject: "book",
  book: "chapter",
  chapter: "topic",
};

function NodeRow({
  kind,
  level,
  id,
  name,
  childCount,
  expanded,
  onToggle,
}: {
  kind: "subject" | "book" | "chapter" | "topic";
  level: number;
  id: string;
  name: string;
  childCount?: number;
  expanded?: boolean;
  onToggle?: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [newName, setNewName] = useState(name);
  const table = (kind + "s") as CurriculumKind;

  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/40"
      style={{ marginLeft: level * 20 }}
      data-testid={`curriculum-${kind}-${id}`}
    >
      {onToggle ? (
        <button
          onClick={onToggle}
          className="w-5 text-muted-foreground"
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          {expanded ? "▾" : "▸"}
        </button>
      ) : (
        <span className="w-5" />
      )}
      {renaming ? (
        <form
          className="flex flex-1 gap-2"
          action={() =>
            startTransition(async () => {
              const { error } = await renameCurriculumNode(table, id, newName);
              if (error) toast.error(error);
              else {
                toast.success("Saved");
                router.refresh();
              }
              setRenaming(false);
            })
          }
        >
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="h-7"
            autoFocus
            data-testid="curriculum-edit-name"
          />
          <Button size="sm" className="h-7" type="submit" disabled={pending}>
            Save
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7"
            type="button"
            onClick={() => setRenaming(false)}
          >
            Cancel
          </Button>
        </form>
      ) : (
        <>
          <span
            className="min-w-0 flex-1 text-sm"
            data-testid={`curriculum-name-${id}`}
          >
            {name}
            {typeof childCount === "number" && (
              <span className="ml-2 text-xs text-muted-foreground">
                {childCount} {childLabel[kind]}
                {childCount === 1 ? "" : "s"}
              </span>
            )}
          </span>
          <div className="flex shrink-0 gap-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs"
              data-testid={`curriculum-edit-${id}`}
              onClick={() => {
                setNewName(name);
                setRenaming(true);
              }}
            >
              Edit
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs text-destructive"
              data-testid={`curriculum-delete-${id}`}
              onClick={() => setConfirmDelete(true)}
            >
              Delete
            </Button>
          </div>
        </>
      )}

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Delete {kind} “{name}”?
            </DialogTitle>
            <DialogDescription>
              This permanently deletes it and everything under it. Questions
              attached to it are also removed. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              data-testid="curriculum-delete-confirm"
              onClick={() =>
                startTransition(async () => {
                  const { error } = await deleteCurriculumNode(table, id);
                  if (error) toast.error(error);
                  else {
                    toast.success("Deleted");
                    router.refresh();
                  }
                  setConfirmDelete(false);
                })
              }
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AddChildForm({
  parentKind,
  parentId,
  level,
}: {
  parentKind: "year" | "subject" | "book" | "chapter";
  parentId: string;
  level: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const kind = childKind[parentKind];

  return (
    <form
      className="flex items-center gap-2 py-1"
      style={{ marginLeft: level * 20 + 28 }}
      action={() =>
        startTransition(async () => {
          const { error } = await addCurriculumNode(kind, parentId, name);
          if (error) toast.error(error);
          else {
            setName("");
            router.refresh();
          }
        })
      }
    >
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={`Add ${childLabel[parentKind]}…`}
        className="h-7 w-64"
        data-testid={`curriculum-add-${parentKind}`}
      />
      <Button
        size="sm"
        variant="secondary"
        className="h-7"
        type="submit"
        disabled={pending || !name.trim()}
      >
        Add
      </Button>
    </form>
  );
}

export function CurriculumTree({
  yearId,
  subjects,
}: {
  yearId: string;
  subjects: SubjectNode[];
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (id: string) => setOpen((o) => ({ ...o, [id]: !o[id] }));

  return (
    <div className="rounded-md border p-3" data-testid="curriculum-tree">
      {subjects.map((s) => (
        <div key={s.id}>
          <NodeRow
            kind="subject"
            level={0}
            id={s.id}
            name={s.name}
            childCount={s.books.length}
            expanded={open[s.id]}
            onToggle={() => toggle(s.id)}
          />
          {open[s.id] && (
            <>
              {s.books.map((b) => (
                <div key={b.id}>
                  <NodeRow
                    kind="book"
                    level={1}
                    id={b.id}
                    name={b.name}
                    childCount={b.chapters.length}
                    expanded={open[b.id]}
                    onToggle={() => toggle(b.id)}
                  />
                  {open[b.id] && (
                    <>
                      {b.chapters.map((c) => (
                        <div key={c.id}>
                          <NodeRow
                            kind="chapter"
                            level={2}
                            id={c.id}
                            name={c.name}
                            childCount={c.topics.length}
                            expanded={open[c.id]}
                            onToggle={() => toggle(c.id)}
                          />
                          {open[c.id] && (
                            <>
                              {c.topics.map((t) => (
                                <NodeRow
                                  key={t.id}
                                  kind="topic"
                                  level={3}
                                  id={t.id}
                                  name={t.name}
                                />
                              ))}
                              <AddChildForm
                                parentKind="chapter"
                                parentId={c.id}
                                level={3}
                              />
                            </>
                          )}
                        </div>
                      ))}
                      <AddChildForm parentKind="book" parentId={b.id} level={2} />
                    </>
                  )}
                </div>
              ))}
              <AddChildForm parentKind="subject" parentId={s.id} level={1} />
            </>
          )}
        </div>
      ))}
      <AddChildForm parentKind="year" parentId={yearId} level={0} />
    </div>
  );
}
