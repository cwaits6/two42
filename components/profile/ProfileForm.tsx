"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { mintSignedUrl, uploadImage } from "@/lib/uploadImage";
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
import { failureMessage } from "@/lib/errorCopy";
import { FieldError, invalidFieldProps } from "@/components/ui/field-error";
import { Camera, Check } from "lucide-react";
import { CheckRow } from "@/components/profile/CheckRow";
import { EmailChangeHint } from "@/components/profile/EmailChangeHint";
import { MONTHS, birthdayColumns, birthdayErrors } from "@/components/profile/birthday";
import { UNREACHABLE_MESSAGE, isReachable } from "@/components/profile/reachability";
import {
  canManageAvatar,
  type AvatarEligibilityCaller,
} from "@/lib/members/avatar-eligibility";
import type { Profile, FamilyUnit } from "@/lib/types";

interface ProfileFormProps {
  profile: Profile;
  families: FamilyUnit[];
  /**
   * The member's own household. When set, last name and address default to
   * the household's and only appear as fields behind a "different from my
   * household" checkbox.
   */
  family?: FamilyUnit | null;
  /** Admin mode allows editing family assignment + ignores privacy enforcement on save */
  isAdmin?: boolean;
  /**
   * Identity + household context of the person editing, used to decide
   * whether they can write this profile's avatar object — see
   * lib/members/avatar-eligibility.ts for the exact predicate, which
   * mirrors the storage RLS policy's two write arms (self, and a household
   * leader with relationship primary/spouse editing another member of the
   * same household). Only the admin route needs to pass it — self- and
   * household-leader edits always have a matching storage write arm, so
   * when omitted the photo control is always shown. When provided and the
   * predicate fails, the control is hidden rather than shown and left to
   * fail (no matching storage write arm exists). The
   * form re-evaluates the predicate against the last *saved* family
   * assignment, so reassigning the member's family in this form updates
   * the control's visibility on save without a page refresh.
   */
  avatarCaller?: AvatarEligibilityCaller | null;
  /**
   * When true, skips the visible-contact requirement.
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

/** Fields that can be marked invalid, keyed by their element id. */
type FieldErrors = Partial<
  Record<
    | "first_name"
    | "last_name"
    | "email"
    | "phone_mobile"
    | "phone_home"
    | "phone_work"
    | "birth_month"
    | "birth_day"
    | "birth_year"
    | "state"
    | "postal_code",
    string
  >
>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

function Optional() {
  return <span className="font-normal text-muted-foreground">(optional)</span>;
}

export function ProfileForm({
  profile,
  families,
  family = null,
  isAdmin = false,
  relaxValidation = false,
  avatarCaller = null,
  onSaved,
}: ProfileFormProps) {
  const [state, setState] = useState<FormState>(initialState(profile));
  const [avatarUrl, setAvatarUrl] = useState<string | null>(profile.avatar_url);
  // The family assignment as last persisted — what the storage RLS policy
  // actually evaluates on an avatar write. The live state.family_id can
  // differ while the admin has an unsaved selection in the Household select,
  // so avatar-write eligibility is derived from this value, updated only
  // after a successful save.
  const [savedFamilyId, setSavedFamilyId] = useState<string | null>(
    profile.family_id,
  );

  // Household defaults: last name falls back to the household surname and
  // address to the household's address unless the member marks theirs different.
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
  const [errors, setErrors] = useState<FieldErrors>({});
  // An object, so a second submit with the same first error still refocuses.
  const [focusTarget, setFocusTarget] = useState<{ id: string } | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const supabase = createClient();

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setState((prev) => ({ ...prev, [key]: value }));
    // Blur rewrites the value through the same path; an unchanged value is not a fix.
    if (key in errors && value !== state[key]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[key as keyof FieldErrors];
        return next;
      });
    }
  };

  // Focus waits for the render that ties the message to the field, so a
  // screen reader reads the message when focus lands.
  useEffect(() => {
    if (focusTarget) document.getElementById(focusTarget.id)?.focus();
  }, [focusTarget]);

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
      // A freshly minted signed URL is already unique (its token), so the
      // new image shows immediately — no manual cache-busting needed.
      setAvatarUrl(await mintSignedUrl(url));

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
      toast.error(failureMessage("upload the photo"));
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

    const phoneMobile = state.phone_mobile
      ? normalizePhone(state.phone_mobile)
      : null;
    const phoneHome = state.phone_home
      ? normalizePhone(state.phone_home)
      : null;
    const phoneWork = state.phone_work
      ? normalizePhone(state.phone_work)
      : null;

    const birthday = {
      month: state.birth_month,
      day: state.birth_day,
      year: state.birth_year,
    };

    // Collected in the order the fields appear, so the first key is the
    // field focus moves to.
    const found: FieldErrors = {};
    if (!firstName) found.first_name = "Enter a first name.";
    if (!lastName) found.last_name = "Enter a last name.";
    // Only admins can edit the email; a member's own is managed in Settings.
    const email = state.email.trim();
    if (isAdmin && email && !EMAIL_PATTERN.test(email)) {
      found.email = "Enter an email address like name@example.com.";
    }

    const reachable = isReachable({
      phoneMobile: state.phone_mobile,
      phoneHome: state.phone_home,
      phoneWork: state.phone_work,
      email: state.email,
      hidePhoneMobile: state.hide_phone_mobile,
      hidePhoneHome: state.hide_phone_home,
      hidePhoneWork: state.hide_phone_work,
      hideEmail: state.hide_email,
    });
    if (!relaxValidation && !reachable) found.phone_mobile = UNREACHABLE_MESSAGE;
    if (state.phone_mobile && !phoneMobile) {
      found.phone_mobile = "Enter a valid phone number.";
    }
    if (state.phone_home && !phoneHome) {
      found.phone_home = "Enter a valid phone number.";
    }
    if (state.phone_work && !phoneWork) {
      found.phone_work = "Enter a valid phone number.";
    }

    Object.assign(found, birthdayErrors(birthday));

    // state/zip normalize to null on malformed input.
    if (ownAddress && state.state && !stateCode) {
      found.state = "Enter a 2-letter state, like TX.";
    }
    if (ownAddress && state.postal_code && !postal) {
      found.postal_code = "Enter a 5-digit ZIP code, or ZIP+4.";
    }

    setErrors(found);
    const firstInvalid = Object.keys(found)[0];
    if (firstInvalid) {
      setSaving(false);
      setFocusTarget({ id: firstInvalid });
      return;
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
      ...birthdayColumns(birthday),
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
      toast.error(failureMessage("save the profile"));
      return;
    }

    if (isAdmin) setSavedFamilyId(state.family_id || null);
    toast.success("Profile saved.");
    onSaved?.();
  };

  // Recomputed per render so a saved family reassignment immediately
  // shows or hides the photo control. No caller context means a route
  // whose write arm is guaranteed (self-edit, household-leader edit).
  const avatarWritable =
    !avatarCaller ||
    canManageAvatar(avatarCaller, { id: profile.id, family_id: savedFamilyId });

  const initials =
    `${state.first_name.charAt(0)}${state.last_name.charAt(0)}`.toUpperCase() ||
    "??";

  const householdItems = [
    { value: "none", label: "No household" },
    ...families.map((f) => ({ value: f.id, label: f.family_name })),
  ];

  return (
    <form onSubmit={handleSubmit} noValidate>
      <Card>
        <CardContent className="space-y-5 pt-6">
          {!isAdmin && !relaxValidation && (
            <p className="text-base text-muted-foreground">
              Anything you fill in here is listed in the directory. To keep
              something private, leave it blank or check its hide box.
            </p>
          )}

          {/* Photo — hidden for admins editing a profile they have no
              storage write arm for: not themselves, and not a household
              they lead (relationship primary/spouse) with the target.
              Follows the last saved family assignment, so reassigning
              the family in this form updates it on save. */}
          {avatarWritable && (
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
          )}

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
                {...invalidFieldProps("first_name", errors.first_name)}
              />
              <FieldError fieldId="first_name" message={errors.first_name} />
            </div>
            {familySurname && (
              <CheckRow
                id="different_last_name"
                label={`My last name is different from my household's (${familySurname})`}
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
                  {...invalidFieldProps("last_name", errors.last_name)}
                />
                <FieldError fieldId="last_name" message={errors.last_name} />
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="preferred_name" className="text-base">
              Preferred name <Optional />
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
              {...invalidFieldProps("email", errors.email)}
            />
            <FieldError fieldId="email" message={errors.email} />
            {!isAdmin && <EmailChangeHint />}
            <CheckRow
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
              {...invalidFieldProps("phone_mobile", errors.phone_mobile)}
            />
            <FieldError fieldId="phone_mobile" message={errors.phone_mobile} />
            <CheckRow
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
              {...invalidFieldProps("phone_home", errors.phone_home)}
            />
            <FieldError fieldId="phone_home" message={errors.phone_home} />
            {state.phone_home && (
              <CheckRow
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
              {...invalidFieldProps("phone_work", errors.phone_work)}
            />
            <FieldError fieldId="phone_work" message={errors.phone_work} />
            {state.phone_work && (
              <CheckRow
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
              Birthday <Optional />
            </Label>
            <div className="grid grid-cols-[1.6fr_1fr_1fr] gap-3">
              <Select
                items={MONTHS}
                value={state.birth_month}
                onValueChange={(v) => update("birth_month", v ?? "")}
              >
                <SelectTrigger
                  id="birth_month"
                  aria-label="Month"
                  className="w-full py-5 text-base"
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
              <Input
                id="birth_day"
                type="number"
                min="1"
                max="31"
                placeholder="Day"
                value={state.birth_day}
                onChange={(e) => update("birth_day", e.target.value)}
                className="py-5 text-base"
                aria-label="Day"
                {...invalidFieldProps("birth_day", errors.birth_day)}
              />
              <Input
                id="birth_year"
                type="number"
                min="1900"
                max="2100"
                placeholder="Year (optional)"
                value={state.birth_year}
                onChange={(e) => update("birth_year", e.target.value)}
                className="py-5 text-base"
                aria-label="Year (optional)"
                {...invalidFieldProps("birth_year", errors.birth_year)}
              />
            </div>
            <FieldError fieldId="birth_month" message={errors.birth_month} />
            <FieldError fieldId="birth_day" message={errors.birth_day} />
            <FieldError fieldId="birth_year" message={errors.birth_year} />
            <p className="text-base text-muted-foreground">
              The year is optional.
            </p>
            <CheckRow
              id="hide_birthday"
              label="Hide my birthday"
              checked={state.hide_birthday}
              onChange={(v) => update("hide_birthday", v)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="anniversary" className="text-base">
              Anniversary <Optional />
            </Label>
            <Input
              id="anniversary"
              type="date"
              value={state.anniversary}
              onChange={(e) => update("anniversary", e.target.value)}
              className="py-5 text-base"
            />
            {state.anniversary && (
              <CheckRow
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
              label="My address is different from my household's"
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
                    {...invalidFieldProps("state", errors.state)}
                  />
                  <FieldError fieldId="state" message={errors.state} />
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
                    {...invalidFieldProps("postal_code", errors.postal_code)}
                  />
                  <FieldError fieldId="postal_code" message={errors.postal_code} />
                </div>
              </div>
              <CheckRow
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
          <p className="text-base text-muted-foreground">
            Sharing what you do helps people in your groups find help from
            someone they know.
          </p>
          {(state.occupation || state.employer) && (
            <CheckRow
              id="hide_occupation"
              label="Hide my occupation and employer"
              checked={state.hide_occupation}
              onChange={(v) => update("hide_occupation", v)}
            />
          )}

          <Separator />

          {/* Directory listing */}
          <div className="space-y-1">
            <CheckRow
              id="is_unlisted"
              label={relaxValidation || isAdmin ? "Hide from the directory" : "Hide me from the directory"}
              checked={state.is_unlisted}
              onChange={(v) => update("is_unlisted", v)}
            />
            <p className="text-base text-muted-foreground">
              The profile won&apos;t appear in the directory at all.
            </p>
          </div>

          {/* Household assignment (admin only) */}
          {isAdmin && (
            <>
              <Separator />
              <div className="space-y-2">
                <Label htmlFor="family_id" className="text-base">
                  Household
                </Label>
                <Select
                  items={householdItems}
                  value={state.family_id || "none"}
                  onValueChange={(v) =>
                    update("family_id", !v || v === "none" ? "" : v)
                  }
                >
                  <SelectTrigger id="family_id" className="py-5 text-base">
                    <SelectValue placeholder="No household" />
                  </SelectTrigger>
                  <SelectContent>
                    {householdItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Link
                  href="/admin/families"
                  className="inline-flex min-h-11 items-center text-base font-semibold text-brand-primary-text underline underline-offset-4"
                >
                  Manage households
                </Link>
              </div>
            </>
          )}

          <div className="border-t pt-5">
            <Button
              type="submit"
              size="lg"
              disabled={saving}
              className="text-base"
            >
              <Check className="mr-2 h-5 w-5" aria-hidden="true" />
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
