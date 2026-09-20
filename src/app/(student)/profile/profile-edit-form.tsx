"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  clearAvatarAction,
  updateOwnProfileAction,
  uploadAvatarAction,
} from "@/lib/actions/profile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ProfileEditForm({
  fullName,
  email,
  contactNumber,
  collegeName,
  avatarUrl,
}: {
  fullName: string;
  email: string;
  contactNumber: string | null;
  collegeName: string | null;
  avatarUrl: string | null;
}) {
  const [name, setName] = useState(fullName);
  const [phone, setPhone] = useState(contactNumber ?? "");
  const [college, setCollege] = useState(collegeName ?? "");
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  function save() {
    startTransition(async () => {
      const res = await updateOwnProfileAction({
        fullName: name,
        contactNumber: phone,
        collegeName: college,
      });
      if (!res.ok) toast.error(res.error);
      else toast.success("Profile updated");
    });
  }

  function onAvatar(file: File | null) {
    if (!file) return;
    const fd = new FormData();
    fd.set("file", file);
    startTransition(async () => {
      const res = await uploadAvatarAction(fd);
      if (!res.ok) toast.error(res.error);
      else toast.success("Profile photo updated");
      if (fileRef.current) fileRef.current.value = "";
    });
  }

  function removeAvatar() {
    startTransition(async () => {
      const res = await clearAvatarAction();
      if (!res.ok) toast.error(res.error);
      else toast.success("Profile photo removed");
    });
  }

  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div className="grid gap-6">
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border bg-muted text-lg font-semibold text-[var(--student-ink)]">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarUrl}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            initials || "?"
          )}
        </div>
        <div className="grid gap-2">
          <p className="text-sm font-medium text-[var(--student-ink)]">Profile photo</p>
          <p className="text-xs text-muted-foreground">
            JPEG, PNG, or WebP up to 2 MB. Shown on leaderboards with your name
            and college only.
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => onAvatar(e.target.files?.[0] ?? null)}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => fileRef.current?.click()}
            >
              {pending ? "Working…" : "Upload photo"}
            </Button>
            {avatarUrl && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={removeAvatar}
              >
                Remove
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="profile-name">Full name</Label>
          <Input
            id="profile-name"
            value={name}
            disabled={pending}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="profile-email">Email</Label>
          <Input id="profile-email" value={email} disabled readOnly />
          <p className="text-xs text-muted-foreground">
            Email is used for sign-in and is never shown on leaderboards.
          </p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="profile-phone">Contact number</Label>
          <Input
            id="profile-phone"
            value={phone}
            disabled={pending}
            onChange={(e) => setPhone(e.target.value)}
            autoComplete="tel"
            placeholder="+92…"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="profile-college">College name</Label>
          <Input
            id="profile-college"
            value={college}
            disabled={pending}
            onChange={(e) => setCollege(e.target.value)}
            placeholder="Your medical college"
          />
        </div>
        <Button
          type="button"
          disabled={pending}
          onClick={save}
          className="w-fit"
        >
          {pending ? "Saving…" : "Save profile"}
        </Button>
      </div>
    </div>
  );
}
