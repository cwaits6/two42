"use client";

import { useEffect, useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { failureMessage } from "@/lib/errorCopy";
import { Camera } from "lucide-react";
import { FieldError, invalidFieldProps } from "@/components/ui/field-error";
import { CheckRow } from "@/components/profile/CheckRow";
import {
  MONTHS,
  birthdayColumns,
  birthdayErrors,
  type BirthdayErrors,
} from "@/components/profile/birthday";
import { titleCaseName } from "@/lib/sanitize";
import { mintSignedUrl, uploadImage } from "@/lib/uploadImage";
import { relObjectPath } from "@/lib/storagePaths";
import type { FamilyMember, FamilyMemberRelationship, FamilyUnit } from "@/lib/types";

const RELATIONSHIPS: { value: FamilyMemberRelationship; label: string }[] = [
  { value: "child", label: "Child" },
  { value: "spouse", label: "Spouse" },
  { value: "parent", label: "Parent" },
  { value: "sibling", label: "Sibling" },
  { value: "other", label: "Other" },
];

type FieldErrors = BirthdayErrors & { first_name?: string };

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
  // Last name defaults to the household surname unless marked different, as
  // ProfileForm does for members with an account. A blank
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
  const [errors, setErrors] = useState<FieldErrors>({});
  // An object, so a second submit with the same first error still refocuses.
  const [focusTarget, setFocusTarget] = useState<{ id: string } | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isNew = member === null;
  const effectiveLastName =
    familySurname && !differentLastName ? familySurname : lastName;
  const displayFirst = preferredName || firstName || "Member";
  const displayLast = effectiveLastName;
  const initials =
    `${firstName.charAt(0)}${effectiveLastName.charAt(0)}`.toUpperCase() || "?";
  const birthday = { month: birthMonth, day: birthDay, year: birthYear };

  // Focus waits for the render that ties the message to the field.
  useEffect(() => {
    if (focusTarget) document.getElementById(focusTarget.id)?.focus();
  }, [focusTarget]);

  const clearError = (field: keyof FieldErrors) =>
    setErrors((prev) => {
      if (!(field in prev)) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });

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
      // A freshly minted signed URL is already unique (its token), so the
      // new image shows immediately — no manual cache-busting needed.
      setAvatarUrl(await mintSignedUrl(url));

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
      toast.error(failureMessage("upload the photo"));
    } finally {
      setUploadingAvatar(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const first = titleCaseName(firstName);
    const found: FieldErrors = {
      ...(first ? {} : { first_name: "Enter a first name." }),
      ...birthdayErrors(birthday),
    };
    setErrors(found);
    const firstInvalid = Object.keys(found)[0];
    if (firstInvalid) {
      setFocusTarget({ id: firstInvalid });
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
      ...birthdayColumns(birthday),
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
      toast.error(failureMessage(`save ${first}`, res.status));
      return;
    }

    toast.success(isNew ? `${first} added. Edit them to add a photo.` : `${first} saved.`);
    onSaved?.();
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6">
      {/* Avatar — only when editing an existing member */}
      {!isNew && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-wrap items-center gap-6">
              <Avatar className="h-24 w-24 shrink-0">
                {avatarUrl && <AvatarImage src={avatarUrl} alt="Photo" />}
                <AvatarFallback className="text-2xl bg-brand-primary text-white">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 space-y-2">
                <p className="text-lg font-semibold">
                  {displayFirst} {displayLast}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingAvatar}
                >
                  <Camera className="mr-2 h-5 w-5" aria-hidden="true" />
                  {uploadingAvatar ? "Uploading…" : "Change photo"}
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarUpload}
                  className="hidden"
                />
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
                First name
              </Label>
              <Input
                id="first_name"
                value={firstName}
                onChange={(e) => {
                  setFirstName(e.target.value);
                  clearError("first_name");
                }}
                onBlur={(e) => setFirstName(titleCaseName(e.target.value) || "")}
                className="text-base py-5"
                {...invalidFieldProps("first_name", errors.first_name)}
              />
              <FieldError fieldId="first_name" message={errors.first_name} />
            </div>
            {familySurname && (
              <CheckRow
                id="different_last_name"
                label={`Last name is different from the household's (${familySurname})`}
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
              Preferred name{" "}
              <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Input
              id="preferred_name"
              value={preferredName}
              onChange={(e) => setPreferredName(e.target.value)}
              onBlur={(e) => setPreferredName(titleCaseName(e.target.value) || "")}
              className="text-base py-5"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="relationship" className="text-base">
              Relationship
            </Label>
            <Select
              items={RELATIONSHIPS}
              value={relationship}
              onValueChange={(v) => setRelationship(v as FamilyMemberRelationship)}
            >
              <SelectTrigger id="relationship" className="w-full text-base py-5">
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
          <p className="text-base font-semibold">
            Birthday <span className="font-normal text-muted-foreground">(optional)</span>
          </p>
          <div className="grid grid-cols-[1.6fr_1fr_1fr] gap-3">
            <div className="space-y-2">
              <Label htmlFor="birth_month" className="text-base">Month</Label>
              <Select
                items={MONTHS}
                value={birthMonth}
                onValueChange={(v) => {
                  setBirthMonth(v ?? "");
                  clearError("birth_month");
                }}
              >
                <SelectTrigger
                  id="birth_month"
                  className="w-full text-base py-5"
                  {...invalidFieldProps("birth_month", errors.birth_month)}
                >
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
                onChange={(e) => {
                  setBirthDay(e.target.value);
                  clearError("birth_day");
                }}
                className="text-base py-5"
                {...invalidFieldProps("birth_day", errors.birth_day)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="birth_year" className="text-base">Year</Label>
              <Input
                id="birth_year"
                type="number"
                min="1900"
                value={birthYear}
                onChange={(e) => {
                  setBirthYear(e.target.value);
                  clearError("birth_year");
                }}
                className="text-base py-5"
                {...invalidFieldProps("birth_year", errors.birth_year)}
              />
            </div>
          </div>
          <FieldError fieldId="birth_month" message={errors.birth_month} />
          <FieldError fieldId="birth_day" message={errors.birth_day} />
          <FieldError fieldId="birth_year" message={errors.birth_year} />
        </CardContent>
      </Card>

      {/* Group attendance */}
      <Card>
        <CardContent className="pt-6">
          <CheckRow
            id="is_class_member"
            label="Attends a group"
            checked={isClassMember}
            onChange={setIsClassMember}
          />
          <p className="text-base text-muted-foreground">
            Check this if they come to a group themselves.
          </p>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : isNew ? "Add to household" : "Save changes"}
        </Button>
        <Button type="button" variant="outline" onClick={() => onCancel?.()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
