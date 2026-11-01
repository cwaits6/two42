"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { mintSignedUrl, uploadImage } from "@/lib/uploadImage";
import { relObjectPath } from "@/lib/storagePaths";
import {
  titleCaseName,
  normalizePhone,
  formatPhoneAsYouType,
} from "@/lib/sanitize";
import { failureMessage } from "@/lib/errorCopy";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FieldError, invalidFieldProps } from "@/components/ui/field-error";
import { CheckRow } from "@/components/profile/CheckRow";
import { EmailChangeHint } from "@/components/profile/EmailChangeHint";
import { MONTHS, birthdayColumns } from "@/components/profile/birthday";
import { relLabel } from "@/components/directory/utils";
import { toast } from "sonner";
import { Camera, Check, Plus } from "lucide-react";
import type { Profile, FamilyMemberRelationship } from "@/lib/types";
import {
  aboutYouErrors,
  contactErrors,
  householdErrors,
  personErrors,
  type PersonDraft,
  type StepErrors,
} from "./setupValidation";

interface HouseholdMatch {
  id: string;
  family_name: string;
  members: { name: string; relationship: string }[];
}

interface PendingPerson extends PersonDraft {
  tempId: string;
  relationship: FamilyMemberRelationship;
}

/** Each step's label in the progress list is also its heading. */
const STEPS = ["About you", "Contact", "Household", "Work"] as const;

const ADDABLE: { relationship: FamilyMemberRelationship; label: string }[] = [
  { relationship: "spouse", label: "Add spouse" },
  { relationship: "child", label: "Add child" },
  { relationship: "parent", label: "Add parent" },
  { relationship: "other", label: "Add someone else" },
];

const EMPTY_DRAFT: PersonDraft = {
  first_name: "",
  last_name: "",
  birth_month: "",
  birth_day: "",
  birth_year: "",
};

const optional = (
  <span className="font-normal text-muted-foreground">(optional)</span>
);

function StepHeading({ step, intro }: { step: number; intro: string }) {
  return (
    <div>
      <h2 className="mb-1 text-2xl">{STEPS[step - 1]}</h2>
      <p className="text-base text-muted-foreground">{intro}</p>
    </div>
  );
}

function BirthdayFields({
  idPrefix,
  month,
  day,
  year,
  onChange,
  errors,
}: {
  idPrefix: string;
  month: string;
  day: string;
  year: string;
  onChange: (field: "birth_month" | "birth_day" | "birth_year", value: string) => void;
  errors: StepErrors;
}) {
  const id = (field: string) => `${idPrefix}${field}`;
  return (
    <>
      <div className="grid grid-cols-[1.6fr_1fr_1fr] gap-3">
        <Select
          items={MONTHS}
          value={month}
          onValueChange={(v) => onChange("birth_month", v ?? "")}
        >
          <SelectTrigger
            id={id("birth_month")}
            aria-label="Month"
            className="w-full py-5 text-base"
            {...invalidFieldProps(id("birth_month"), errors[id("birth_month")])}
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
          id={id("birth_day")}
          type="number"
          min="1"
          max="31"
          placeholder="Day"
          aria-label="Day"
          value={day}
          onChange={(e) => onChange("birth_day", e.target.value)}
          className="py-5 text-base"
          {...invalidFieldProps(id("birth_day"), errors[id("birth_day")])}
        />
        <Input
          id={id("birth_year")}
          type="number"
          min="1900"
          placeholder="Year"
          aria-label="Year (optional)"
          value={year}
          onChange={(e) => onChange("birth_year", e.target.value)}
          className="py-5 text-base"
          {...invalidFieldProps(id("birth_year"), errors[id("birth_year")])}
        />
      </div>
      <FieldError fieldId={id("birth_month")} message={errors[id("birth_month")]} />
      <FieldError fieldId={id("birth_day")} message={errors[id("birth_day")]} />
      <FieldError fieldId={id("birth_year")} message={errors[id("birth_year")]} />
    </>
  );
}

// Module level so a parent re-render never remounts it and drops focus.
function PersonAddForm({
  label,
  draft,
  setDraft,
  lastNameFallback,
  errors,
  onAdd,
  onCancel,
}: {
  label: string;
  draft: PersonDraft;
  setDraft: React.Dispatch<React.SetStateAction<PersonDraft>>;
  lastNameFallback: string;
  errors: StepErrors;
  onAdd: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-4 rounded-lg border border-border bg-muted/30 p-4">
      <h3 className="text-xl">{label}</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="add_first_name" className="text-base">
            First name
          </Label>
          <Input
            id="add_first_name"
            value={draft.first_name}
            onChange={(e) => setDraft((d) => ({ ...d, first_name: e.target.value }))}
            className="py-5 text-base"
            {...invalidFieldProps("add_first_name", errors.add_first_name)}
          />
          <FieldError fieldId="add_first_name" message={errors.add_first_name} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="add_last_name" className="text-base">
            Last name {optional}
          </Label>
          <Input
            id="add_last_name"
            value={draft.last_name}
            onChange={(e) => setDraft((d) => ({ ...d, last_name: e.target.value }))}
            placeholder={titleCaseName(lastNameFallback) ?? ""}
            className="py-5 text-base"
          />
        </div>
      </div>
      <div className="space-y-2">
        <p className="text-base font-medium">Birthday {optional}</p>
        <BirthdayFields
          idPrefix="add_"
          month={draft.birth_month}
          day={draft.birth_day}
          year={draft.birth_year}
          onChange={(field, value) => setDraft((d) => ({ ...d, [field]: value }))}
          errors={errors}
        />
      </div>
      <div className="flex flex-wrap gap-3">
        <Button type="button" onClick={onAdd}>
          {label}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

interface SetupWizardProps {
  profile: Profile;
  userEmail: string;
  /** The name of the household the profile already belongs to, if any */
  householdName: string | null;
}

export function SetupWizard({ profile, userEmail, householdName: initialHouseholdName }: SetupWizardProps) {
  const router = useRouter();
  const supabase = createClient();

  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<StepErrors>({});
  // An object, so a second attempt with the same first error still refocuses.
  const [focusTarget, setFocusTarget] = useState<{ id: string } | null>(null);
  const headingRef = useRef<HTMLDivElement>(null);

  // About you
  const [firstName, setFirstName] = useState(profile.first_name ?? "");
  const [lastName, setLastName] = useState(profile.last_name ?? "");
  const [preferredName, setPreferredName] = useState(profile.preferred_name ?? "");
  const [birthMonth, setBirthMonth] = useState(profile.birth_month?.toString() ?? "");
  const [birthDay, setBirthDay] = useState(profile.birth_day?.toString() ?? "");
  const [birthYear, setBirthYear] = useState(profile.birth_year?.toString() ?? "");
  const [hideBirthYear, setHideBirthYear] = useState(profile.hide_birth_year ?? false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(profile.avatar_url);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Contact
  const [phoneMobile, setPhoneMobile] = useState(profile.phone_mobile ?? "");
  const [phoneHome, setPhoneHome] = useState(profile.phone_home ?? "");
  const [phoneWork, setPhoneWork] = useState(profile.phone_work ?? "");
  const [showExtraPhones, setShowExtraPhones] = useState(
    !!(profile.phone_home || profile.phone_work),
  );
  const [hideEmail, setHideEmail] = useState(profile.hide_email ?? false);
  const [hidePhoneMobile, setHidePhoneMobile] = useState(profile.hide_phone_mobile ?? false);

  // Household
  const [searchDone, setSearchDone] = useState(false);
  const [matches, setMatches] = useState<HouseholdMatch[]>([]);
  const [householdId, setHouseholdId] = useState<string | null>(profile.family_id ?? null);
  const [householdName, setHouseholdName] = useState<string | null>(initialHouseholdName);
  const [householdAdded, setHouseholdAdded] = useState(false);
  const [creatingHousehold, setCreatingHousehold] = useState(false);
  const [pendingPeople, setPendingPeople] = useState<PendingPerson[]>([]);
  // A retry after a later write fails must not insert these people again.
  const savedPeople = useRef<Set<string>>(new Set());
  const [anniversary, setAnniversary] = useState(profile.anniversary ?? "");
  const [adding, setAdding] = useState<FamilyMemberRelationship | null>(null);
  const [draft, setDraft] = useState<PersonDraft>(EMPTY_DRAFT);

  // Work
  const [occupation, setOccupation] = useState(profile.occupation ?? "");
  const [employer, setEmployer] = useState(profile.employer ?? "");

  const initials = `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase() || "?";
  const hasSpouse = pendingPeople.some((m) => m.relationship === "spouse");
  const surname = titleCaseName(lastName) ?? lastName.trim();

  // Focus waits for the render that ties the message to the field, so a
  // screen reader reads the message when focus lands.
  useEffect(() => {
    if (focusTarget) document.getElementById(focusTarget.id)?.focus();
  }, [focusTarget]);

  /** Shows the errors and moves focus to the first; true when there are none. */
  const accept = (found: StepErrors) => {
    setErrors(found);
    const first = Object.keys(found)[0];
    if (first) setFocusTarget({ id: first });
    return !first;
  };

  const clearError = (id: string) =>
    setErrors((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingAvatar(true);
    try {
      const url = await uploadImage(file, "avatar", relObjectPath("profiles", profile.id, "avatar"));
      // A freshly minted signed URL is already unique (its token), so the
      // new image shows immediately — no manual cache-busting needed.
      setAvatarUrl(await mintSignedUrl(url));
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

  const openAddForm = (relationship: FamilyMemberRelationship) => {
    setAdding(relationship);
    setDraft(EMPTY_DRAFT);
    setErrors({});
    setFocusTarget({ id: "add_first_name" });
  };

  /** Adds the open form's person; false when the form still needs fixing. */
  const addPendingPerson = () => {
    if (!adding) return true;
    if (!accept(personErrors(draft))) return false;
    setPendingPeople((prev) => [
      ...prev,
      {
        ...draft,
        tempId: crypto.randomUUID(),
        first_name: titleCaseName(draft.first_name) ?? "",
        last_name: titleCaseName(draft.last_name) ?? "",
        relationship: adding,
      },
    ]);
    setAdding(null);
    setDraft(EMPTY_DRAFT);
    return true;
  };

  const findHousehold = async () => {
    if (!surname) {
      setStep(1);
      accept({ last_name: "Enter a last name." });
      return;
    }
    try {
      const res = await fetch("/api/profile/resolve-family", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ last_name: surname }),
      });
      if (!res.ok) {
        toast.error(failureMessage("search for your household", res.status));
        return;
      }
      const json = await res.json();
      setMatches(json.matches ?? []);
      setSearchDone(true);
      clearError("household");
    } catch {
      toast.error(failureMessage("search for your household", "network"));
    }
  };

  const joinHousehold = (match: HouseholdMatch) => {
    setHouseholdId(match.id);
    setHouseholdName(match.family_name);
    setHouseholdAdded(false);
    clearError("household");
  };

  const addHousehold = async () => {
    if (!surname || creatingHousehold) return;
    setCreatingHousehold(true);
    // The household search matches names of this form.
    const name = `${surname} Family`;
    const { data, error } = await supabase
      .from("family_units")
      .insert({ family_name: name })
      .select("id")
      .single();
    setCreatingHousehold(false);
    if (error || !data) {
      console.error(error);
      toast.error(failureMessage("add the household"));
      return;
    }
    setHouseholdId(data.id);
    setHouseholdName(name);
    setHouseholdAdded(true);
    clearError("household");
  };

  const stepErrors = (): StepErrors => {
    if (step === 1) return aboutYouErrors({ firstName, lastName, birthMonth, birthDay, birthYear });
    if (step === 2) {
      return contactErrors({
        phoneMobile,
        phoneHome,
        phoneWork,
        email: userEmail,
        hidePhoneMobile,
        hidePhoneHome: profile.hide_phone_home ?? false,
        hidePhoneWork: profile.hide_phone_work ?? false,
        hideEmail,
      });
    }
    if (step === 3) return householdErrors(householdId !== null);
    return {};
  };

  const goTo = (next: number) => {
    setErrors({});
    setStep(next);
    window.scrollTo({ top: 0 });
    // Moves a screen reader to the new step's heading.
    requestAnimationFrame(() => headingRef.current?.focus());
  };

  const goNext = () => {
    // An open add form is added, not silently dropped.
    if (step === 3 && !addPendingPerson()) return;
    if (accept(stepErrors())) goTo(step + 1);
  };

  const handleFinish = async () => {
    setSaving(true);
    try {
      const { error: profileError } = await supabase
        .from("profiles")
        .update({
          first_name: titleCaseName(firstName) ?? "",
          last_name: titleCaseName(lastName) ?? "",
          preferred_name: titleCaseName(preferredName),
          ...birthdayColumns({ month: birthMonth, day: birthDay, year: birthYear }),
          hide_birth_year: hideBirthYear,
          phone_mobile: phoneMobile ? normalizePhone(phoneMobile) : null,
          phone_home: phoneHome ? normalizePhone(phoneHome) : null,
          phone_work: phoneWork ? normalizePhone(phoneWork) : null,
          hide_email: hideEmail,
          hide_phone_mobile: hidePhoneMobile,
          family_id: householdId,
          occupation: occupation.trim() || null,
          employer: employer.trim() || null,
        })
        .eq("id", profile.id);
      if (profileError) throw profileError;

      if (householdId && hasSpouse && anniversary) {
        const { error } = await supabase
          .from("family_units")
          .update({ anniversary })
          .eq("id", householdId);
        if (error) throw error;
      }

      const unsavedPeople = pendingPeople.filter((m) => !savedPeople.current.has(m.tempId));
      if (householdId && unsavedPeople.length > 0) {
        const { error } = await supabase.from("family_members").insert(
          unsavedPeople.map((m) => ({
            family_id: householdId,
            first_name: m.first_name,
            last_name: m.last_name || null,
            ...birthdayColumns({ month: m.birth_month, day: m.birth_day, year: m.birth_year }),
            relationship: m.relationship,
            is_class_member: false,
          })),
        );
        if (error) throw error;
        for (const m of unsavedPeople) savedPeople.current.add(m.tempId);
      }

      // Marked complete only after every dependent write succeeds.
      const { error: setupError } = await supabase
        .from("profiles")
        .update({ setup_completed: true })
        .eq("id", profile.id);
      if (setupError) throw setupError;

      toast.success("Profile set up.");
      router.push("/directory");
    } catch (err) {
      console.error(err);
      toast.error(failureMessage("finish setting up your profile"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <ol aria-label="Setup steps" className="grid grid-cols-4 gap-2">
        {STEPS.map((label, i) => {
          const num = i + 1;
          const done = num < step;
          const active = num === step;
          return (
            <li
              key={label}
              aria-current={active ? "step" : undefined}
              className="flex flex-col items-center gap-2 text-center"
            >
              <span
                aria-hidden="true"
                className={`flex h-10 w-10 items-center justify-center rounded-full text-base font-semibold ${
                  done || active
                    ? "bg-primary text-primary-foreground"
                    : "border border-border bg-card text-foreground"
                } ${active ? "ring-4 ring-primary/25" : ""}`}
              >
                {done ? <Check className="h-5 w-5" /> : num}
              </span>
              <span
                className={`text-base leading-tight ${
                  active ? "font-semibold text-foreground" : "text-muted-foreground"
                }`}
              >
                <span className="sr-only">{`Step ${num}: `}</span>
                {label}
                {done && <span className="sr-only"> (done)</span>}
              </span>
            </li>
          );
        })}
      </ol>

      <Card className="py-6">
        <CardContent className="space-y-6">
          <div ref={headingRef} tabIndex={-1} className="outline-none">
            {step === 1 && (
              <StepHeading step={1} intro="Your name and photo, as the directory shows them." />
            )}
            {step === 2 && (
              <StepHeading step={2} intro="Only signed-in members of your church can see these." />
            )}
            {step === 3 && (
              <StepHeading step={3} intro="The people you live with, listed together in the directory." />
            )}
            {step === 4 && (
              <StepHeading
                step={4}
                intro="Sharing what you do helps people in your groups find help from someone they know."
              />
            )}
          </div>

          {step === 1 && (
            <>
              <div className="flex flex-wrap items-center gap-5">
                <Avatar className="h-20 w-20 shrink-0">
                  {avatarUrl && <AvatarImage src={avatarUrl} alt="Profile photo" />}
                  <AvatarFallback className="bg-brand-primary text-2xl text-white">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="space-y-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingAvatar}
                  >
                    <Camera className="mr-2 h-5 w-5" aria-hidden="true" />
                    {uploadingAvatar ? "Uploading…" : avatarUrl ? "Change photo" : "Add photo"}
                  </Button>
                  <p className="text-base text-muted-foreground">A photo is optional.</p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarUpload}
                  className="hidden"
                />
              </div>

              <Separator />

              <div className="grid gap-4 sm:grid-cols-2">
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
                    onBlur={(e) => setFirstName(titleCaseName(e.target.value) ?? "")}
                    autoComplete="given-name"
                    className="py-5 text-base"
                    {...invalidFieldProps("first_name", errors.first_name)}
                  />
                  <FieldError fieldId="first_name" message={errors.first_name} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="last_name" className="text-base">
                    Last name
                  </Label>
                  <Input
                    id="last_name"
                    value={lastName}
                    onChange={(e) => {
                      setLastName(e.target.value);
                      clearError("last_name");
                    }}
                    onBlur={(e) => setLastName(titleCaseName(e.target.value) ?? "")}
                    autoComplete="family-name"
                    className="py-5 text-base"
                    {...invalidFieldProps("last_name", errors.last_name)}
                  />
                  <FieldError fieldId="last_name" message={errors.last_name} />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="preferred_name" className="text-base">
                  Preferred name {optional}
                </Label>
                <Input
                  id="preferred_name"
                  value={preferredName}
                  onChange={(e) => setPreferredName(e.target.value)}
                  onBlur={(e) => setPreferredName(titleCaseName(e.target.value) ?? "")}
                  className="py-5 text-base"
                />
                <p className="text-base text-muted-foreground">
                  The name people call you, if it isn&apos;t your first name.
                </p>
              </div>

              <Separator />

              <div className="space-y-2">
                <p className="text-base font-medium">Birthday {optional}</p>
                <BirthdayFields
                  idPrefix=""
                  month={birthMonth}
                  day={birthDay}
                  year={birthYear}
                  onChange={(field, value) => {
                    if (field === "birth_month") setBirthMonth(value);
                    if (field === "birth_day") setBirthDay(value);
                    if (field === "birth_year") setBirthYear(value);
                    clearError(field);
                  }}
                  errors={errors}
                />
                <p className="text-base text-muted-foreground">The year is optional.</p>
                {birthYear && (
                  <CheckRow
                    id="hide_birth_year"
                    label="Hide my birth year"
                    checked={hideBirthYear}
                    onChange={setHideBirthYear}
                  />
                )}
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div className="space-y-2">
                <Label htmlFor="phone_mobile" className="text-base">
                  Mobile phone {optional}
                </Label>
                <Input
                  id="phone_mobile"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={phoneMobile}
                  onChange={(e) => {
                    setPhoneMobile(formatPhoneAsYouType(e.target.value));
                    clearError("phone_mobile");
                  }}
                  placeholder="(555) 123-4567"
                  className="py-5 text-base"
                  {...invalidFieldProps("phone_mobile", errors.phone_mobile)}
                />
                <FieldError fieldId="phone_mobile" message={errors.phone_mobile} />
                <CheckRow
                  id="hide_phone_mobile"
                  label="Hide my mobile number"
                  checked={hidePhoneMobile}
                  onChange={(v) => {
                    setHidePhoneMobile(v);
                    clearError("phone_mobile");
                  }}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="email" className="text-base">
                  Email
                </Label>
                <Input id="email" value={userEmail} disabled className="py-5 text-base" />
                <EmailChangeHint />
                <CheckRow
                  id="hide_email"
                  label="Hide my email from the directory"
                  checked={hideEmail}
                  onChange={(v) => {
                    setHideEmail(v);
                    clearError("phone_mobile");
                  }}
                />
              </div>

              {!showExtraPhones ? (
                <Button type="button" variant="outline" onClick={() => setShowExtraPhones(true)}>
                  <Plus className="mr-2 h-5 w-5" aria-hidden="true" />
                  Add home or work phone
                </Button>
              ) : (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <Label htmlFor="phone_home" className="text-base">
                      Home phone {optional}
                    </Label>
                    <Input
                      id="phone_home"
                      type="tel"
                      inputMode="tel"
                      value={phoneHome}
                      onChange={(e) => {
                        setPhoneHome(formatPhoneAsYouType(e.target.value));
                        clearError("phone_home");
                        clearError("phone_mobile");
                      }}
                      placeholder="(555) 123-4567"
                      className="py-5 text-base"
                      {...invalidFieldProps("phone_home", errors.phone_home)}
                    />
                    <FieldError fieldId="phone_home" message={errors.phone_home} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="phone_work" className="text-base">
                      Work phone {optional}
                    </Label>
                    <Input
                      id="phone_work"
                      type="tel"
                      inputMode="tel"
                      value={phoneWork}
                      onChange={(e) => {
                        setPhoneWork(formatPhoneAsYouType(e.target.value));
                        clearError("phone_work");
                        clearError("phone_mobile");
                      }}
                      placeholder="(555) 123-4567"
                      className="py-5 text-base"
                      {...invalidFieldProps("phone_work", errors.phone_work)}
                    />
                    <FieldError fieldId="phone_work" message={errors.phone_work} />
                  </div>
                </>
              )}
            </>
          )}

          {step === 3 && (
            <>
              {householdId === null ? (
                <div className="space-y-4">
                  {!searchDone ? (
                    <>
                      <p className="text-base">
                        We&apos;ll look for a household under your last name, {surname}.
                      </p>
                      <Button
                        id="household"
                        type="button"
                        onClick={findHousehold}
                        {...invalidFieldProps("household", errors.household)}
                      >
                        Find my household
                      </Button>
                    </>
                  ) : matches.length > 0 ? (
                    <>
                      <p className="text-base font-medium">Is one of these your household?</p>
                      {matches.map((match, i) => (
                        <div key={match.id} className="space-y-3 rounded-lg border border-border p-4">
                          <p className="text-lg font-semibold text-foreground">{match.family_name}</p>
                          {match.members.length > 0 && (
                            <p className="text-base text-muted-foreground">
                              {match.members.map((m) => m.name).join(", ")}
                            </p>
                          )}
                          <Button
                            id={i === 0 ? "household" : undefined}
                            type="button"
                            onClick={() => joinHousehold(match)}
                            {...(i === 0 ? invalidFieldProps("household", errors.household) : {})}
                          >
                            Join this household
                          </Button>
                        </div>
                      ))}
                      <Button
                        type="button"
                        variant="outline"
                        onClick={addHousehold}
                        disabled={creatingHousehold}
                      >
                        Add a new household
                      </Button>
                    </>
                  ) : (
                    <>
                      <p className="text-base">
                        No household was found under {surname}. Add one, and you can add the
                        people you live with next.
                      </p>
                      <Button
                        id="household"
                        type="button"
                        onClick={addHousehold}
                        disabled={creatingHousehold}
                        {...invalidFieldProps("household", errors.household)}
                      >
                        Add household
                      </Button>
                    </>
                  )}
                  <FieldError fieldId="household" message={errors.household} />
                </div>
              ) : (
                <div className="flex items-center gap-3 rounded-lg border border-border bg-brand-warm p-4">
                  <Check className="h-6 w-6 shrink-0 text-brand-primary-text" aria-hidden="true" />
                  <div>
                    <p className="text-lg font-semibold text-foreground">{householdName ?? "Your household"}</p>
                    <p className="text-base text-muted-foreground">
                      {householdAdded ? "Household added." : "You're in this household."}
                    </p>
                  </div>
                </div>
              )}

              {householdId !== null && (
                <div className="space-y-4">
                  <Separator />
                  <div>
                    <h3 className="text-xl">People in your household</h3>
                    <p className="text-base text-muted-foreground">
                      Optional. Add anyone who lives with you and doesn&apos;t have their own
                      account.
                    </p>
                  </div>

                  {pendingPeople.length > 0 && (
                    <ul className="space-y-2">
                      {pendingPeople.map((m) => (
                        <li
                          key={m.tempId}
                          className="flex items-center justify-between gap-3 rounded-lg border border-border px-4 py-2"
                        >
                          <span className="min-w-0">
                            <span className="block text-base font-medium">
                              {m.first_name} {m.last_name || surname}
                            </span>
                            <span className="block text-base text-muted-foreground">
                              {relLabel(m.relationship)}
                            </span>
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() =>
                              setPendingPeople((prev) => prev.filter((p) => p.tempId !== m.tempId))
                            }
                            aria-label={`Remove ${m.first_name}`}
                          >
                            Remove
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}

                  {hasSpouse && (
                    <div className="space-y-2">
                      <Label htmlFor="anniversary" className="text-base">
                        Anniversary {optional}
                      </Label>
                      <Input
                        id="anniversary"
                        type="date"
                        value={anniversary}
                        onChange={(e) => setAnniversary(e.target.value)}
                        className="py-5 text-base"
                      />
                    </div>
                  )}

                  {adding ? (
                    <PersonAddForm
                      label={ADDABLE.find((a) => a.relationship === adding)?.label ?? "Add person"}
                      draft={draft}
                      setDraft={(next) => {
                        setDraft(next);
                        setErrors({});
                      }}
                      lastNameFallback={lastName}
                      errors={errors}
                      onAdd={() => void addPendingPerson()}
                      onCancel={() => {
                        setAdding(null);
                        setErrors({});
                      }}
                    />
                  ) : (
                    <div className="flex flex-wrap gap-3">
                      {ADDABLE.filter((a) => a.relationship !== "spouse" || !hasSpouse).map((a) => (
                        <Button
                          key={a.relationship}
                          type="button"
                          variant="outline"
                          onClick={() => openAddForm(a.relationship)}
                        >
                          <Plus className="mr-2 h-5 w-5" aria-hidden="true" />
                          {a.label}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {step === 4 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="occupation" className="text-base">
                  Occupation {optional}
                </Label>
                <Input
                  id="occupation"
                  value={occupation}
                  onChange={(e) => setOccupation(e.target.value)}
                  placeholder="e.g. Teacher, Plumber"
                  className="py-5 text-base"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="employer" className="text-base">
                  Employer {optional}
                </Label>
                <Input
                  id="employer"
                  value={employer}
                  onChange={(e) => setEmployer(e.target.value)}
                  className="py-5 text-base"
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap-reverse items-center justify-between gap-3">
        {step > 1 ? (
          <Button type="button" variant="outline" onClick={() => goTo(step - 1)}>
            Back
          </Button>
        ) : (
          <span />
        )}
        {step < STEPS.length ? (
          <Button type="button" onClick={goNext}>
            Continue
          </Button>
        ) : (
          <Button type="button" onClick={handleFinish} disabled={saving}>
            {saving ? "Saving…" : "Finish setup"}
          </Button>
        )}
      </div>
    </div>
  );
}
