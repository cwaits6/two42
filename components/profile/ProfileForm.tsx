"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { uploadImage } from "@/lib/uploadImage";
import { relObjectPath } from "@/lib/storagePaths";
import {
  titleCaseName,
  titleCaseStreet,
  titleCaseCity,
  normalizePhone,
  normalizeState,
  normalizePostalCode,
  normalizeEmail,
  trimText,
  formatPhone,
  formatPhoneAsYouType,
} from "@/lib/sanitize";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from "sonner";
import { Camera, Check } from "lucide-react";
import type { Profile, FamilyUnit } from "@/lib/types";

interface ProfileFormProps {
  profile: Profile;
  families: FamilyUnit[];
  /**
   * The member's own family. When set, last name and address default to the
   * family's and only appear as fields behind a "different from my family"
   * checkbox.
   */
  family?: FamilyUnit | null;
  /** Admin mode allows editing family assignment + ignores privacy enforcement on save */
  isAdmin?: boolean;
  /**
   * When true, skips the birthday and visible-contact requirements.
   * Used when a household primary/spouse edits another member's profile —
   * the person being edited may have an incomplete profile that they will
   * fill in themselves.
   */
  relaxValidation?: boolean;
  /** Called after successful save so parent can refresh/redirect */
  onSaved?: () => void;
}

/** Form state — strings for all inputs (conversion happens on save) */
interface FormState {
  first_name: string;
  last_name: string;
  preferred_name: string;
  email: string;
  phone_mobile: string;
  phone_home: string;
  phone_work: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  postal_code: string;
  birth_month: string;
  birth_day: string;
  birth_year: string;
  anniversary: string;
  occupation: string;
  employer: string;
  family_id: string;
  hide_phone_mobile: boolean;
  hide_phone_home: boolean;
  hide_phone_work: boolean;
  hide_email: boolean;
  hide_address: boolean;
  hide_birthday: boolean;
  hide_birth_year: boolean;
  hide_anniversary: boolean;
  hide_occupation: boolean;
  is_unlisted: boolean;
}

function initialState(profile: Profile): FormState {
  return {
    first_name: profile.first_name || "",
    last_name: profile.last_name || "",
    preferred_name: profile.preferred_name || "",
    email: profile.email || "",
    phone_mobile: formatPhone(profile.phone_mobile),
    phone_home: formatPhone(profile.phone_home),
    phone_work: formatPhone(profile.phone_work),
    address_line1: profile.address_line1 || "",
    address_line2: profile.address_line2 || "",
    city: profile.city || "",
    state: profile.state || "",
    postal_code: profile.postal_code || "",
    birth_month: profile.birth_month?.toString() || "",
    birth_day: profile.birth_day?.toString() || "",
    birth_year: profile.birth_year?.toString() || "",
    anniversary: profile.anniversary || "",
    occupation: profile.occupation || "",
    employer: profile.employer || "",
    family_id: profile.family_id || "",
    hide_phone_mobile: profile.hide_phone_mobile ?? false,
    hide_phone_home: profile.hide_phone_home ?? false,
    hide_phone_work: profile.hide_phone_work ?? false,
    hide_email: profile.hide_email ?? false,
    hide_address: profile.hide_address ?? false,
    hide_birthday: profile.hide_birthday ?? false,
    hide_birth_year: profile.hide_birth_year ?? false,
    hide_anniversary: profile.hide_anniversary ?? false,
    hide_occupation: profile.hide_occupation ?? false,
    is_unlisted: profile.is_unlisted ?? false,
  };
}

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

function Required() {
  return <span className="font-normal text-muted-foreground">(required)</span>;
}

function Optional() {
  return <span className="font-normal text-muted-foreground">(optional)</span>;
}

/** Checkbox that reveals fields for info that differs from the family's */
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
      className="flex cursor-pointer items-center gap-3 py-1 text-base font-medium"
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

/** Inline privacy switch rendered directly under the field it hides */
function HideRow({
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
    <div className="flex items-center justify-between gap-4 pt-2">
      <Label htmlFor={id} className="cursor-pointer font-medium">
        {label}
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

export function ProfileForm({
  profile,
  families,
  family = null,
  isAdmin = false,
  relaxValidation = false,
  onSaved,
}: ProfileFormProps) {
  const [state, setState] = useState<FormState>(initialState(profile));
  const [avatarUrl, setAvatarUrl] = useState<string | null>(profile.avatar_url);

  // Family defaults: last name falls back to the family surname and address
  // to the family's home address unless the member marks theirs different.
  const familySurname =
    (!isAdmin && family?.family_name?.replace(/\s+family$/i, "").trim()) || "";
  const [differentLastName, setDifferentLastName] = useState(
    !familySurname || (profile.last_name || "") !== familySurname,
  );
  const familyHasAddress = !!(family?.address_line1 || family?.city);
  const [differentAddress, setDifferentAddress] = useState(
    !familyHasAddress ||
      !!(profile.address_line1 || profile.address_line2 || profile.city),
  );
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const supabase = createClient();

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setState((prev) => ({ ...prev, [key]: value }));

  const handleAvatarUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingAvatar(true);
    try {
      const url = await uploadImage(
        file,
        "avatar",
        relObjectPath("profiles", profile.id, "avatar"),
      );
      // Cache-bust so the new image shows immediately.
      const bustedUrl = `${url}?t=${Date.now()}`;
      setAvatarUrl(bustedUrl);

      // Persist on the profile so a refresh keeps the change even if the
      // user doesn't save the rest of the form.
      const { error } = await supabase
        .from("profiles")
        .update({ avatar_url: url })
        .eq("id", profile.id);
      if (error) throw error;
      toast.success("Photo updated.");
    } catch (err) {
      console.error(err);
      toast.error("Failed to upload photo.");
    } finally {
      setUploadingAvatar(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);

    // Sanitize + normalize everything before writing.
    const firstName = titleCaseName(state.first_name);
    const lastName =
      familySurname && !differentLastName
        ? familySurname
        : titleCaseName(state.last_name);
    const preferredName = titleCaseName(state.preferred_name);
    // Unchecked "different address" means: use the family's address (blank).
    const ownAddress = !familyHasAddress || differentAddress;
    const city = ownAddress ? titleCaseCity(state.city) : null;
    const stateCode = ownAddress ? normalizeState(state.state) : null;
    const postal =
      ownAddress && state.postal_code
        ? normalizePostalCode(state.postal_code)
        : null;

    // Validate required fields.
    if (!firstName) {
      toast.error("First name is required.");
      setSaving(false);
      return;
    }
    if (!lastName) {
      toast.error("Last name is required.");
      setSaving(false);
      return;
    }
    if (!relaxValidation && (!state.birth_month || !state.birth_day)) {
      toast.error("Birthday month and day are required.");
      setSaving(false);
      return;
    }
    // At least one phone or a visible email is required so members can be reached.
    const hasPhone = !!(
      (state.phone_mobile && !state.hide_phone_mobile) ||
      (state.phone_home && !state.hide_phone_home) ||
      (state.phone_work && !state.hide_phone_work)
    );
    const hasVisibleEmail = !!state.email && !state.hide_email;
    if (!relaxValidation && !hasPhone && !hasVisibleEmail) {
      toast.error(
        "Please provide at least one phone number, or keep your email visible so others can reach you.",
      );
      setSaving(false);
      return;
    }

    // Validate required shapes — state/zip return null on malformed input.
    if (ownAddress && state.state && !stateCode) {
      toast.error("State must be a 2-letter abbreviation, like TX.");
      setSaving(false);
      return;
    }
    if (ownAddress && state.postal_code && !postal) {
      toast.error("ZIP code must be 5 digits or ZIP+4 format.");
      setSaving(false);
      return;
    }

    const phoneMobile = state.phone_mobile
      ? normalizePhone(state.phone_mobile)
      : null;
    const phoneHome = state.phone_home
      ? normalizePhone(state.phone_home)
      : null;
    const phoneWork = state.phone_work
      ? normalizePhone(state.phone_work)
      : null;

    if (state.phone_mobile && !phoneMobile) {
      toast.error("Mobile phone number isn't valid.");
      setSaving(false);
      return;
    }
    if (state.phone_home && !phoneHome) {
      toast.error("Home phone number isn't valid.");
      setSaving(false);
      return;
    }
    if (state.phone_work && !phoneWork) {
      toast.error("Work phone number isn't valid.");
      setSaving(false);
      return;
    }

    const birthMonth = state.birth_month ? Number(state.birth_month) : null;
    const birthDay = state.birth_day ? Number(state.birth_day) : null;
    const birthYear = state.birth_year ? Number(state.birth_year) : null;

    // Calendar-aware birthday check — rejects impossible dates like Feb 31.
    // Without a year, leap year 2000 is assumed so Feb 29 stays allowed.
    if (birthDay !== null) {
      const maxDay = birthMonth
        ? new Date(birthYear ?? 2000, birthMonth, 0).getDate()
        : 31;
      if (!Number.isInteger(birthDay) || birthDay < 1 || birthDay > maxDay) {
        toast.error("That birthday day doesn't exist in the selected month.");
        setSaving(false);
        return;
      }
    }

    const updates = {
      first_name: firstName,
      last_name: lastName,
      preferred_name: preferredName,
      // The email field is disabled for non-admins (changed via Settings),
      // and RLS pins profiles.email on non-admin updates — don't send it.
      ...(isAdmin ? { email: normalizeEmail(state.email) } : {}),
      phone_mobile: phoneMobile,
      phone_home: phoneHome,
      phone_work: phoneWork,
      address_line1: ownAddress ? titleCaseStreet(state.address_line1) : null,
      address_line2: ownAddress ? titleCaseStreet(state.address_line2) : null,
      city,
      state: stateCode,
      postal_code: postal,
      birth_month: birthMonth,
      birth_day: birthDay,
      birth_year: birthYear,
      anniversary: state.anniversary || null,
      occupation: trimText(state.occupation),
      employer: trimText(state.employer),
      ...(isAdmin
        ? { family_id: state.family_id || null }
        : {}),
      hide_phone_mobile: state.hide_phone_mobile,
      hide_phone_home: state.hide_phone_home,
      hide_phone_work: state.hide_phone_work,
      hide_email: state.hide_email,
      hide_address: state.hide_address,
      hide_birthday: state.hide_birthday,
      hide_birth_year: state.hide_birth_year,
      hide_anniversary: state.hide_anniversary,
      hide_occupation: state.hide_occupation,
      is_unlisted: state.is_unlisted,
    };

    const { error } = await supabase
      .from("profiles")
      .update(updates)
      .eq("id", profile.id);

    setSaving(false);

    if (error) {
      console.error(error);
      toast.error("Failed to save profile.");
      return;
    }

    toast.success("Profile saved.");
    onSaved?.();
  };

  const initials =
    `${state.first_name.charAt(0)}${state.last_name.charAt(0)}`.toUpperCase() ||
    "??";

  return (
    <form onSubmit={handleSubmit}>
      <Card>
        <CardContent className="space-y-5 pt-6">
          {!isAdmin && !relaxValidation && (
            <p className="text-base text-muted-foreground">
              Anything you fill in here is listed in the group directory. If
              you&apos;d rather keep something private, leave it blank or turn
              on its hide switch.
            </p>
          )}

          {/* Photo */}
          <div className="flex items-center gap-5">
            <Avatar className="h-20 w-20 shrink-0">
              {avatarUrl && <AvatarImage src={avatarUrl} alt="Profile photo" />}
              <AvatarFallback className="bg-brand-primary text-2xl text-white">
                {initials}
              </AvatarFallback>
            </Avatar>
            <Button
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingAvatar}
            >
              <Camera className="mr-2 h-4 w-4" />
              {uploadingAvatar
                ? "Uploading..."
                : relaxValidation
                  ? "Change their photo"
                  : "Change my photo"}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleAvatarUpload}
              className="hidden"
            />
          </div>

          {/* Name */}
          <div className={familySurname ? "space-y-2" : "grid gap-4 sm:grid-cols-2"}>
            <div className="space-y-2">
              <Label htmlFor="first_name" className="text-base">
                First name
              </Label>
              <Input
                id="first_name"
                value={state.first_name}
                onChange={(e) => update("first_name", e.target.value)}
                onBlur={(e) =>
                  update("first_name", titleCaseName(e.target.value) || "")
                }
                required
                className="py-5 text-base"
              />
            </div>
            {familySurname && (
              <CheckRow
                id="different_last_name"
                label={`My last name is different from my family's (${familySurname})`}
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
                  value={state.last_name}
                  onChange={(e) => update("last_name", e.target.value)}
                  onBlur={(e) =>
                    update("last_name", titleCaseName(e.target.value) || "")
                  }
                  required
                  className="py-5 text-base"
                />
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="preferred_name" className="text-base">
              Nickname <Optional />
            </Label>
            <Input
              id="preferred_name"
              value={state.preferred_name}
              onChange={(e) => update("preferred_name", e.target.value)}
              onBlur={(e) =>
                update("preferred_name", titleCaseName(e.target.value) || "")
              }
              className="py-5 text-base"
            />
          </div>

          <Separator />

          {/* Email */}
          <div className="space-y-2">
            <Label htmlFor="email" className="text-base">
              Email
            </Label>
            <Input
              id="email"
              type="email"
              value={state.email}
              onChange={(e) => update("email", e.target.value)}
              disabled={!isAdmin}
              className="py-5 text-base"
            />
            {!isAdmin && (
              <p className="text-sm text-muted-foreground">
                To change your email, use the{" "}
                <Link
                  href="/settings"
                  className="text-brand-primary underline underline-offset-4"
                >
                  Settings page
                </Link>
                .
              </p>
            )}
            <HideRow
              id="hide_email"
              label="Hide my email from the directory"
              checked={state.hide_email}
              onChange={(v) => update("hide_email", v)}
            />
          </div>

          {/* Phones */}
          <div className="space-y-2">
            <Label htmlFor="phone_mobile" className="text-base">
              Mobile phone
            </Label>
            <Input
              id="phone_mobile"
              type="tel"
              inputMode="tel"
              value={state.phone_mobile}
              onChange={(e) =>
                update("phone_mobile", formatPhoneAsYouType(e.target.value))
              }
              placeholder="(555) 123-4567"
              className="py-5 text-base"
            />
            <HideRow
              id="hide_phone_mobile"
              label="Hide my mobile number"
              checked={state.hide_phone_mobile}
              onChange={(v) => update("hide_phone_mobile", v)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone_home" className="text-base">
              Home phone <Optional />
            </Label>
            <Input
              id="phone_home"
              type="tel"
              inputMode="tel"
              value={state.phone_home}
              onChange={(e) =>
                update("phone_home", formatPhoneAsYouType(e.target.value))
              }
              placeholder="(555) 123-4567"
              className="py-5 text-base"
            />
            {state.phone_home && (
              <HideRow
                id="hide_phone_home"
                label="Hide my home number"
                checked={state.hide_phone_home}
                onChange={(v) => update("hide_phone_home", v)}
              />
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone_work" className="text-base">
              Work phone <Optional />
            </Label>
            <Input
              id="phone_work"
              type="tel"
              inputMode="tel"
              value={state.phone_work}
              onChange={(e) =>
                update("phone_work", formatPhoneAsYouType(e.target.value))
              }
              placeholder="(555) 123-4567"
              className="py-5 text-base"
            />
            {state.phone_work && (
              <HideRow
                id="hide_phone_work"
                label="Hide my work number"
                checked={state.hide_phone_work}
                onChange={(v) => update("hide_phone_work", v)}
              />
            )}
          </div>

          <Separator />

          {/* Birthday */}
          <div className="space-y-2">
            <Label className="text-base">
              Birthday {relaxValidation ? <Optional /> : <Required />}
            </Label>
            <div className="grid grid-cols-[1.6fr_1fr_1fr] gap-3">
              <Select
                items={MONTHS}
                value={state.birth_month}
                onValueChange={(v) => update("birth_month", v ?? "")}
              >
                <SelectTrigger className="w-full py-5 text-base">
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
              <Input
                type="number"
                min="1"
                max="31"
                placeholder="Day"
                value={state.birth_day}
                onChange={(e) => update("birth_day", e.target.value)}
                className="py-5 text-base"
                aria-label="Day"
              />
              <Input
                type="number"
                min="1900"
                max="2100"
                placeholder="Year (optional)"
                value={state.birth_year}
                onChange={(e) => update("birth_year", e.target.value)}
                className="py-5 text-base"
                aria-label="Year (optional)"
              />
            </div>
            <p className="text-sm text-muted-foreground">
              The year is optional — the directory only shows the month and
              day.
            </p>
            <HideRow
              id="hide_birthday"
              label="Hide my birthday"
              checked={state.hide_birthday}
              onChange={(v) => update("hide_birthday", v)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="anniversary" className="text-base">
              Anniversary
            </Label>
            <Input
              id="anniversary"
              type="date"
              value={state.anniversary}
              onChange={(e) => update("anniversary", e.target.value)}
              className="py-5 text-base"
            />
            {state.anniversary && (
              <HideRow
                id="hide_anniversary"
                label="Hide my anniversary"
                checked={state.hide_anniversary}
                onChange={(v) => update("hide_anniversary", v)}
              />
            )}
          </div>

          <Separator />

          {/* Address */}
          {familyHasAddress && (
            <CheckRow
              id="different_address"
              label="My address is different from my family's home address"
              checked={differentAddress}
              onChange={setDifferentAddress}
            />
          )}
          {(!familyHasAddress || differentAddress) && (
            <>
              <div className="space-y-2">
                <Label htmlFor="address_line1" className="text-base">
                  Street address <Optional />
                </Label>
                <Input
                  id="address_line1"
                  value={state.address_line1}
                  onChange={(e) => update("address_line1", e.target.value)}
                  onBlur={(e) =>
                    update(
                      "address_line1",
                      titleCaseStreet(e.target.value) || "",
                    )
                  }
                  placeholder="123 Main St"
                  className="py-5 text-base"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="address_line2" className="text-base">
                  Apt / unit <Optional />
                </Label>
                <Input
                  id="address_line2"
                  value={state.address_line2}
                  onChange={(e) => update("address_line2", e.target.value)}
                  onBlur={(e) =>
                    update(
                      "address_line2",
                      titleCaseStreet(e.target.value) || "",
                    )
                  }
                  placeholder="Apt 4B"
                  className="py-5 text-base"
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-6">
                <div className="space-y-2 sm:col-span-3">
                  <Label htmlFor="city" className="text-base">
                    City
                  </Label>
                  <Input
                    id="city"
                    value={state.city}
                    onChange={(e) => update("city", e.target.value)}
                    onBlur={(e) =>
                      update("city", titleCaseCity(e.target.value) || "")
                    }
                    className="py-5 text-base"
                  />
                </div>
                <div className="space-y-2 sm:col-span-1">
                  <Label htmlFor="state" className="text-base">
                    State
                  </Label>
                  <Input
                    id="state"
                    value={state.state}
                    onChange={(e) =>
                      update("state", e.target.value.toUpperCase())
                    }
                    maxLength={2}
                    placeholder="TX"
                    className="py-5 text-base uppercase"
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="postal_code" className="text-base">
                    ZIP
                  </Label>
                  <Input
                    id="postal_code"
                    value={state.postal_code}
                    onChange={(e) => update("postal_code", e.target.value)}
                    placeholder="12345"
                    className="py-5 text-base"
                  />
                </div>
              </div>
              <HideRow
                id="hide_address"
                label="Hide my address from the directory"
                checked={state.hide_address}
                onChange={(v) => update("hide_address", v)}
              />
            </>
          )}

          <Separator />

          {/* Occupation */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="occupation" className="text-base">
                Occupation <Optional />
              </Label>
              <Input
                id="occupation"
                value={state.occupation}
                onChange={(e) => update("occupation", e.target.value)}
                placeholder="e.g. Plumber, Teacher"
                className="py-5 text-base"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="employer" className="text-base">
                Employer <Optional />
              </Label>
              <Input
                id="employer"
                value={state.employer}
                onChange={(e) => update("employer", e.target.value)}
                placeholder="Company / organization"
                className="py-5 text-base"
              />
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Sharing what you do helps others in the class find help from
            someone they know.
          </p>
          {(state.occupation || state.employer) && (
            <HideRow
              id="hide_occupation"
              label="Hide my occupation and employer"
              checked={state.hide_occupation}
              onChange={(v) => update("hide_occupation", v)}
            />
          )}

          <Separator />

          {/* Directory listing */}
          <div className="space-y-1">
            <HideRow
              id="is_unlisted"
              label="Hide me from the directory entirely"
              checked={state.is_unlisted}
              onChange={(v) => update("is_unlisted", v)}
            />
            <p className="text-sm text-muted-foreground">
              The profile will not appear in the member directory at all.
            </p>
          </div>

          {/* Family assignment (admin only) */}
          {isAdmin && (
            <>
              <Separator />
              <div className="space-y-2">
                <Label htmlFor="family_id" className="text-base">
                  Family
                </Label>
                <Select
                  value={state.family_id || "none"}
                  onValueChange={(v) =>
                    update("family_id", !v || v === "none" ? "" : v)
                  }
                >
                  <SelectTrigger className="py-5 text-base">
                    <SelectValue placeholder="No family assigned">
                      {(v: string | null | undefined) => {
                        if (!v || v === "none") return "No family assigned";
                        return families.find((f) => f.id === v)?.family_name ?? "(Unknown family)";
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— No family —</SelectItem>
                    {families.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.family_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-sm text-muted-foreground">
                  Manage families on the{" "}
                  <a
                    href="/admin/families"
                    className="text-brand-primary underline"
                  >
                    Families page
                  </a>
                  .
                </p>
              </div>
            </>
          )}

          <div className="border-t pt-5">
            <Button
              type="submit"
              size="lg"
              disabled={saving}
              className="bg-brand-primary text-base text-white hover:bg-brand-primary/90"
            >
              <Check className="mr-2 h-4 w-4" />
              {saving ? "Saving..." : "Save my changes"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
