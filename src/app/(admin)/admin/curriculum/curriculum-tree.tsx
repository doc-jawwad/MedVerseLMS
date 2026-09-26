"use client";

import { memo, useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  addCurriculumNode,
  renameCurriculumNode,
  deleteCurriculumNode,
  type CurriculumKind,
} from "@/lib/actions/curriculum";
import { curriculumErrorMessage } from "@/lib/curriculum/errors";
import { treeIndentStyle } from "@/lib/admin/curriculum-indent";
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

const NodeRow = memo(function NodeRow({
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
  onToggle?: (id: string) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [newName, setNewName] = useState(name);
  const table = (kind + "s") as CurriculumKind;

  return (
    <div
      className="min-w-0 max-w-full"
      style={treeIndentStyle(level)}
      data-testid={`curriculum-${kind}-${id}`}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/40">
        {onToggle ? (
          <button
            onClick={() => onToggle(id)}
            className="w-5 shrink-0 text-muted-foreground"
            aria-label={expanded ? "Collapse" : "Expand"}
          >
            {expanded ? "▾" : "▸"}
          </button>
        ) : (
          <span className="w-5 shrink-0" />
        )}
        {renaming ? (
          <form
            className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
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
              className="h-7 min-w-0 flex-1 basis-32"
              autoFocus
              data-testid="curriculum-edit-name"
            />
            <Button size="sm" className="h-7 shrink-0" type="submit" disabled={pending}>
              Save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 shrink-0"
              type="button"
              onClick={() => setRenaming(false)}
            >
              Cancel
            </Button>
          </form>
        ) : (
          <>
            <span
              className="min-w-0 flex-1 basis-32 break-words text-sm"
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
      </div>

      {confirmDelete ? (
        <Dialog open onOpenChange={setConfirmDelete}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                Delete {kind} “{name}”?
              </DialogTitle>
              <DialogDescription>
                Deletes this {kind} only when it is empty — no child items and
                no questions (including Content Bin). Remove children first,
                then move or purge questions. This cannot be undone.
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
                    if (error) toast.error(curriculumErrorMessage(error));
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
      ) : null}
    </div>
  );
});

const AddChildForm = memo(function AddChildForm({
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
      className="flex min-w-0 max-w-full items-center gap-2 py-1"
      style={treeIndentStyle(level, 28)}
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
        className="h-7 min-w-0 flex-1 basis-32"
        data-testid={`curriculum-add-${parentKind}`}
      />
      <Button
        size="sm"
        variant="secondary"
        className="h-7 shrink-0"
        type="submit"
        disabled={pending || !name.trim()}
      >
        Add
      </Button>
    </form>
  );
});

export function CurriculumTree({
  yearId,
  subjects,
}: {
  yearId: string;
  subjects: SubjectNode[];
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = useCallback((id: string) => {
    setOpen((o) => ({ ...o, [id]: !o[id] }));
  }, []);

  return (
    <div
      className="min-w-0 max-w-full overflow-x-hidden rounded-md border p-3 [--tree-indent:12px] md:[--tree-indent:20px]"
      data-testid="curriculum-tree"
    >
      {subjects.map((s) => (
        <div key={s.id} className="min-w-0">
          <NodeRow
            kind="subject"
            level={0}
            id={s.id}
            name={s.name}
            childCount={s.books.length}
            expanded={!!open[s.id]}
            onToggle={toggle}
          />
          {open[s.id] ? (
            <>
              {s.books.map((b) => (
                <div key={b.id} className="min-w-0">
                  <NodeRow
                    kind="book"
                    level={1}
                    id={b.id}
                    name={b.name}
                    childCount={b.chapters.length}
                    expanded={!!open[b.id]}
                    onToggle={toggle}
                  />
                  {open[b.id] ? (
                    <>
                      {b.chapters.map((c) => (
                        <div key={c.id} className="min-w-0">
                          <NodeRow
                            kind="chapter"
                            level={2}
                            id={c.id}
                            name={c.name}
                            childCount={c.topics.length}
                            expanded={!!open[c.id]}
                            onToggle={toggle}
                          />
                          {open[c.id] ? (
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
                          ) : null}
                        </div>
                      ))}
                      <AddChildForm parentKind="book" parentId={b.id} level={2} />
                    </>
                  ) : null}
                </div>
              ))}
              <AddChildForm parentKind="subject" parentId={s.id} level={1} />
            </>
          ) : null}
        </div>
      ))}
      <AddChildForm parentKind="year" parentId={yearId} level={0} />
    </div>
  );
}
