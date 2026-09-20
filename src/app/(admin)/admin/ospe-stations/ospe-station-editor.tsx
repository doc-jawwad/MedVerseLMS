"use client";

import { useState, useTransition } from "react";
import { yearDisplayName } from "@/lib/library/types";
import { toast } from "sonner";
import {
  createOspeStation,
  deleteOspeStation,
  setOspeStationStatus,
  updateOspeStation,
} from "@/lib/actions/ospe-stations";
import { studyErrorMessage } from "@/lib/study/errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Year = { id: string; year_number: number; name?: string | null };
type Subject = { id: string; name: string; year_id: string };

export function OspeStationEditor({
  years,
  subjects,
  stationId,
  initial,
  lockYear,
  previewImageSrc,
}: {
  years: Year[];
  subjects: Subject[];
  stationId?: string;
  lockYear?: boolean;
  /** Private stream URL for existing image (admin-authorized). */
  previewImageSrc?: string | null;
  initial?: {
    title: string;
    answer: string;
    year_id: string;
    subject_id: string;
    status: "draft" | "published";
    sort_order: number;
  };
}) {
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [answer, setAnswer] = useState(initial?.answer ?? "");
  const [yearId, setYearId] = useState(initial?.year_id ?? years[0]?.id ?? "");
  const [subjectId, setSubjectId] = useState(initial?.subject_id ?? "");
  const [status, setStatus] = useState<"draft" | "published">(
    initial?.status ?? "draft"
  );
  const [sortOrder, setSortOrder] = useState(String(initial?.sort_order ?? 0));
  const [imageName, setImageName] = useState<string | null>(null);

  const yearSubjects = subjects.filter((s) => s.year_id === yearId);
  const lockedYear = years.find((y) => y.id === yearId);

  function buildFormData(fileInput: HTMLInputElement | null) {
    const fd = new FormData();
    fd.set("title", title);
    fd.set("answer", answer);
    fd.set("yearId", yearId);
    fd.set("subjectId", subjectId);
    fd.set("status", status);
    fd.set("sortOrder", sortOrder);
    const file = fileInput?.files?.[0];
    if (file) fd.set("image", file);
    return fd;
  }

  return (
    <form
      className="grid max-w-2xl gap-4"
      data-testid="ospe-station-editor"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const fileInput = form.querySelector<HTMLInputElement>(
          'input[name="image"]'
        );
        startTransition(async () => {
          if (stationId) {
            const res = await updateOspeStation(
              stationId,
              buildFormData(fileInput)
            );
            if (res?.error) toast.error(studyErrorMessage(res.error));
            else toast.success("Saved");
          } else {
            const res = await createOspeStation(buildFormData(fileInput));
            if (res?.error) toast.error(studyErrorMessage(res.error));
          }
        });
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="ospe-title">Station title</Label>
        <Input
          id="ospe-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="ospe-answer">Answer (hidden until Reveal)</Label>
        <Textarea
          id="ospe-answer"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          className="min-h-24"
          required
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label>Class / year</Label>
          {lockYear ? (
            <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm">
              {lockedYear ? yearDisplayName(lockedYear) : "Selected class"}
            </div>
          ) : (
            <Select
              value={yearId}
              onValueChange={(v) => {
                setYearId(v);
                setSubjectId("");
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {years.map((y) => (
                  <SelectItem key={y.id} value={y.id}>
                    {yearDisplayName(y)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <div className="grid gap-2">
          <Label>Block / subject</Label>
          <Select
            value={subjectId}
            onValueChange={setSubjectId}
            disabled={!yearId}
          >
            <SelectTrigger>
              <SelectValue placeholder="Subject" />
            </SelectTrigger>
            <SelectContent>
              {yearSubjects.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="ospe-sort">Sort order</Label>
          <Input
            id="ospe-sort"
            type="number"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label>Status</Label>
          <Select
            value={status}
            onValueChange={(v) => setStatus(v as "draft" | "published")}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="published">Published</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="ospe-image">
          Station image (JPEG / PNG / WebP
          {stationId ? ", optional replace" : ""})
        </Label>
        <Input
          id="ospe-image"
          name="image"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          required={!stationId}
          onChange={(e) =>
            setImageName(e.target.files?.[0]?.name ?? null)
          }
        />
        {imageName ? (
          <p className="text-xs text-muted-foreground">Selected: {imageName}</p>
        ) : null}
        {previewImageSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewImageSrc}
            alt="Current station"
            className="mt-2 max-h-56 max-w-full rounded-lg border object-contain"
            data-testid="ospe-admin-preview"
          />
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          disabled={
            pending || !title.trim() || !answer.trim() || !subjectId
          }
        >
          {pending ? "Saving…" : stationId ? "Save" : "Create draft"}
        </Button>
        {stationId ? (
          <>
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const next = status === "published" ? "draft" : "published";
                  const { error } = await setOspeStationStatus(stationId, next);
                  if (error) toast.error(studyErrorMessage(error));
                  else setStatus(next);
                })
              }
            >
              {status === "published" ? "Unpublish" : "Publish"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="text-destructive"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  if (!window.confirm("Delete this OSPE station?")) return;
                  const { error } = await deleteOspeStation(stationId);
                  if (error) toast.error(studyErrorMessage(error));
                })
              }
            >
              Delete
            </Button>
          </>
        ) : null}
      </div>
    </form>
  );
}
