"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Camera } from "lucide-react";
import { titleCaseName } from "@/lib/sanitize";
import { uploadImage } from "@/lib/uploadImage";
import { relObjectPath } from "@/lib/storagePaths";
import type { FamilyMember, FamilyMemberRelationship, FamilyUnit } from "@/lib/types";

const MONTHS = [
  { value: "1", label: "January" },
  { value: "2", label: "February" },
  { value: "3", label: "March" },
  { value: "4", label: "April" },
  { value: "5", label: "May" },
  { value: "6", label: "June" },
  { value: "7", label: "July" },
  { value: "8", label: "August" },
  { value: "9", label: "September" },
  { value: "10", label: "October" },
  { value: "11", label: "November" },
  { value: "12", label: "December" },
];

const RELATIONSHIPS: { value: FamilyMemberRelationship; label: string }[] = [
  { value: "child", label: "Child" },
  { value: "spouse", label: "Spouse" },
  { value: "parent", label: "Parent" },
  { value: "sibling", label: "Sibling" },
  { value: "other", label: "Other" },
];

function CheckRow({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      htmlFor={id}
      className="flex min-h-12 cursor-pointer items-center gap-3 py-1 text-base font-medium"
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-5 shrink-0 accent-brand-primary"
      />
      {label}
    </label>
  );
}

interface Props {
  /** null = creating new member */
  member: FamilyMember | null;
  family: FamilyUnit;
  onSaved?: () => void;
  onCancel?: () => void;
  /** Called after an avatar-only update, which doesn't close the sheet like onSaved does */
  onChanged?: () => void;
}

export function FamilyMemberForm({ member, family, onSaved, onCancel, onChanged }: Props) {
  // Last name defaults to the family surname unless marked different — mirrors
  // the same convention used for enrolled members in ProfileForm. A blank
  // existing last name is treated as "not yet set" rather than "different",
  // so new and not-yet-named members inherit silently.
  const familySurname = family.family_name.replace(/\s+family$/i, "").trim();
  const [firstName, setFirstName] = useState(member?.first_name ?? "");
  const [lastName, setLastName] = useState(member?.last_name ?? "");
  const [differentLastName, setDifferentLastName] = useState(
    !familySurname || (!!member?.last_name && member.last_name !== familySurname),
  );
  const [preferredName, setPreferredName] = useState(member?.preferred_name ?? "");
  const [relationship, setRelationship] = useState<FamilyMemberRelationship>(
    member?.relationship ?? "child",
  );
  const [birthMonth, setBirthMonth] = useState(member?.birth_month?.toString() ?? "");
  const [birthDay, setBirthDay] = useState(member?.birth_day?.toString() ?? "");
  const [birthYear, setBirthYear] = useState(member?.birth_year?.toString() ?? "");
  const [isClassMember, setIsClassMember] = useState(member?.is_class_member ?? false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(member?.avatar_url ?? null);

  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isNew = member === null;
  const effectiveLastName =
    familySurname && !differentLastName ? familySurname : lastName;
  const displayFirst = preferredName || firstName || "Member";
  const displayLast = effectiveLastName;
  const initials =
    `${firstName.charAt(0)}${effectiveLastName.charAt(0)}`.toUpperCase() || "?";
  const currentYear = new Date().getFullYear();

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !member) return; // avatar upload only works after creation (member.id needed)

    const previousAvatarUrl = avatarUrl;
    setUploadingAvatar(true);
    try {
      const url = await uploadImage(
        file,
        "avatar",
        relObjectPath("family-members", member.id, "avatar"),
      );
      const bustedUrl = `${url}?t=${Date.now()}`;
      setAvatarUrl(bustedUrl);

      const res = await fetch(`/api/household/members/${member.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatar_url: url }),
      });
      if (!res.ok) throw new Error("Failed to save avatar");
      toast.success("Photo updated.");
      onChanged?.();
    } catch (err) {
      console.error(err);
      setAvatarUrl(previousAvatarUrl);
      toast.error("Failed to upload photo.");
    } finally {
      setUploadingAvatar(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const first = titleCaseName(firstName);
    if (!first) {
      toast.error("First name is required.");
      return;
    }

    // Basic date sanity checks
    const dayNum = birthDay ? Number(birthDay) : null;
    const monthNum = birthMonth ? Number(birthMonth) : null;
    const yearNum = birthYear ? Number(birthYear) : null;
    if (dayNum !== null && (dayNum < 1 || dayNum > 31)) {
      toast.error("Birthday day must be between 1 and 31.");
      return;
    }
    if (yearNum !== null && (yearNum < 1900 || yearNum > currentYear)) {
      toast.error(`Birthday year must be between 1900 and ${currentYear}.`);
      return;
    }
    if ((monthNum !== null) !== (dayNum !== null)) {
      toast.error("Please provide both a month and a day for the birthday.");
      return;
    }

    setSaving(true);

    const last =
      familySurname && !differentLastName ? familySurname : titleCaseName(lastName);

    const payload = {
      first_name: first,
      last_name: last || null,
      preferred_name: titleCaseName(preferredName) || null,
      relationship,
      birth_month: birthMonth ? Number(birthMonth) : null,
      birth_day: birthDay ? Number(birthDay) : null,
      birth_year: birthYear ? Number(birthYear) : null,
      is_class_member: isClassMember,
    };

    const url = isNew ? "/api/household/members" : `/api/household/members/${member.id}`;
    const method = isNew ? "POST" : "PATCH";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    setSaving(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? "Failed to save.");
      return;
    }

    if (isNew) {
      toast.success("Family member added. You can add a photo by editing them.");
    } else {
      toast.success("Family member updated.");
    }
    onSaved?.();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Avatar — only when editing an existing member */}
      {!isNew && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-6">
              <div className="relative">
                <Avatar className="h-24 w-24">
                  {avatarUrl && <AvatarImage src={avatarUrl} alt="Photo" />}
                  <AvatarFallback className="text-2xl bg-brand-primary text-white">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingAvatar}
                  className="absolute -bottom-1 -right-1 flex h-12 w-12 items-center justify-center rounded-full bg-brand-primary text-white shadow-md transition-colors hover:bg-brand-primary/90 disabled:opacity-50"
                  aria-label="Upload photo"
                >
                  <Camera className="h-5 w-5" />
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarUpload}
                  className="hidden"
                />
              </div>
              <div>
                <p className="text-lg font-semibold">
                  {displayFirst} {displayLast}
                </p>
                <p className="text-sm text-muted-foreground">
                  {uploadingAvatar ? "Uploading..." : "Click the camera icon to update the photo."}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Name */}
      <Card>
        <CardContent className="pt-6 space-y-5">
          <div className={familySurname ? "space-y-3" : "grid sm:grid-cols-2 gap-4"}>
            <div className="space-y-2">
              <Label htmlFor="first_name" className="text-base">
                First name <span className="text-destructive" aria-hidden>*</span>
              </Label>
              <Input
                id="first_name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                onBlur={(e) => setFirstName(titleCaseName(e.target.value) || "")}
                required
                className="text-base py-5"
              />
            </div>
            {familySurname && (
              <CheckRow
                id="different_last_name"
                label={`Last name is different from the family's (${familySurname})`}
                checked={differentLastName}
                onChange={setDifferentLastName}
              />
            )}
            {(!familySurname || differentLastName) && (
              <div className="space-y-2">
                <Label htmlFor="last_name" className="text-base">
                  Last name
                </Label>
                <Input
                  id="last_name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  onBlur={(e) => setLastName(titleCaseName(e.target.value) || "")}
                  className="text-base py-5"
                />
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="preferred_name" className="text-base">
              Preferred name / nickname{" "}
              <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Input
              id="preferred_name"
              value={preferredName}
              onChange={(e) => setPreferredName(e.target.value)}
              onBlur={(e) => setPreferredName(titleCaseName(e.target.value) || "")}
              placeholder="Goes by..."
              className="text-base py-5"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="relationship" className="text-base">
              Relationship <span className="text-destructive" aria-hidden>*</span>
            </Label>
            <Select
              items={RELATIONSHIPS}
              value={relationship}
              onValueChange={(v) => setRelationship(v as FamilyMemberRelationship)}
            >
              <SelectTrigger id="relationship" className="text-base py-5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RELATIONSHIPS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Birthday */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Birthday
          </p>
          <div className="grid grid-cols-[1.6fr_1fr_1fr] gap-3">
            <div className="space-y-2">
              <Label className="text-base">Month</Label>
              <Select items={MONTHS} value={birthMonth} onValueChange={(v) => setBirthMonth(v ?? "")}>
                <SelectTrigger className="w-full text-base py-5">
                  <SelectValue placeholder="Month" />
                </SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="birth_day" className="text-base">Day</Label>
              <Input
                id="birth_day"
                type="number"
                min="1"
                max="31"
                value={birthDay}
                onChange={(e) => setBirthDay(e.target.value)}
                placeholder="Day"
                className="text-base py-5"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="birth_year" className="text-base">Year</Label>
              <Input
                id="birth_year"
                type="number"
                min="1900"
                max={currentYear}
                value={birthYear}
                onChange={(e) => setBirthYear(e.target.value)}
                placeholder="Year"
                className="text-base py-5"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Class membership */}
      <Card>
        <CardContent className="pt-6">
          <Separator className="mb-4" />
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="is_class_member" className="text-base cursor-pointer">
                Attends small group
              </Label>
              <p className="text-sm text-muted-foreground">
                Mark this if they attend the small group class themselves.
              </p>
            </div>
            <Switch
              id="is_class_member"
              checked={isClassMember}
              onCheckedChange={setIsClassMember}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => onCancel?.()}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={saving}
          className="bg-brand-primary hover:bg-brand-primary/90 text-white"
        >
          {saving ? "Saving..." : isNew ? "Add Family Member" : "Save Changes"}
        </Button>
      </div>
    </form>
  );
}
