"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { uploadImage } from "@/lib/uploadImage";
import { relObjectPath } from "@/lib/storagePaths";
import {
  titleCaseName,
  normalizePhone,
  formatPhoneAsYouType,
} from "@/lib/sanitize";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Camera,
  ChevronRight,
  ChevronLeft,
  Check,
  Plus,
  Users,
  Trash2,
} from "lucide-react";
import type { Profile, FamilyMemberRelationship } from "@/lib/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FamilyMatch {
  id: string;
  family_name: string;
  members: { name: string; relationship: string }[];
}

interface PendingFamilyMember {
  tempId: string;
  first_name: string;
  last_name: string;
  birth_month: string;
  birth_day: string;
  birth_year: string;
  relationship: FamilyMemberRelationship;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

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

const STEP_LABELS = [
  "Who are you?",
  "How to reach you",
  "Your household",
  "About you",
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// MemberAddForm — defined at module level so React never remounts it on parent
// re-renders (a nested function definition would get a new identity each time).
// ---------------------------------------------------------------------------

interface MemberAddFormProps {
  title: string;
  form: {
    first_name: string;
    last_name: string;
    birth_month: string;
    birth_day: string;
    birth_year: string;
  };
  setForm: React.Dispatch<
    React.SetStateAction<{
      first_name: string;
      last_name: string;
      birth_month: string;
      birth_day: string;
      birth_year: string;
    }>
  >;
  relationship: FamilyMemberRelationship;
  lastNameFallback: string;
  onAdd: (
    rel: FamilyMemberRelationship,
    form: {
      first_name: string;
      last_name: string;
      birth_month: string;
      birth_day: string;
      birth_year: string;
    },
  ) => boolean;
  onAdded: () => void;
  onCancel: () => void;
}

function MemberAddForm({
  title,
  form,
  setForm,
  relationship,
  lastNameFallback,
  onAdd,
  onAdded,
  onCancel,
}: MemberAddFormProps) {
  return (
    <div className="border rounded-lg p-4 space-y-4 bg-muted/30">
      <p className="font-medium text-sm">{title}</p>
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-base">First name *</Label>
          <Input
            value={form.first_name}
            onChange={(e) =>
              setForm((f) => ({ ...f, first_name: e.target.value }))
            }
            placeholder="First name"
            className="text-base py-5"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-sm">Last name</Label>
          <Input
            value={form.last_name}
            onChange={(e) =>
              setForm((f) => ({ ...f, last_name: e.target.value }))
            }
            placeholder={titleCaseName(lastNameFallback) ?? ""}
            className="text-base py-5"
          />
        </div>
      </div>
      <div>
        <Label className="text-sm">Birthday (optional)</Label>
        <div className="grid grid-cols-[1.6fr_1fr_1fr] gap-2 mt-1">
          <Select
            items={MONTHS}
            value={form.birth_month}
            onValueChange={(v) =>
              setForm((f) => ({ ...f, birth_month: v ?? "" }))
            }
          >
            <SelectTrigger className="w-full text-sm">
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
            value={form.birth_day}
            onChange={(e) =>
              setForm((f) => ({ ...f, birth_day: e.target.value }))
            }
            className="text-sm py-5"
          />
          <Input
            type="number"
            min="1900"
            max="2100"
            placeholder="Year"
            value={form.birth_year}
            onChange={(e) =>
              setForm((f) => ({ ...f, birth_year: e.target.value }))
            }
            className="text-sm py-5"
          />
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          className="bg-brand-primary hover:bg-brand-primary/90 text-white"
          onClick={() => {
            if (onAdd(relationship, form)) {
              onAdded();
            }
          }}
        >
          Add {relationship}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

interface SetupWizardProps {
  profile: Profile;
  userEmail: string;
}

export function SetupWizard({ profile, userEmail }: SetupWizardProps) {
  const router = useRouter();
  const supabase = createClient();

  // Step tracking
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);

  // ---- Step 1: Identity ----
  const [firstName, setFirstName] = useState(profile.first_name ?? "");
  const [lastName, setLastName] = useState(profile.last_name ?? "");
  const [preferredName, setPreferredName] = useState(
    profile.preferred_name ?? "",
  );
  const [birthMonth, setBirthMonth] = useState(
    profile.birth_month?.toString() ?? "",
  );
  const [birthDay, setBirthDay] = useState(profile.birth_day?.toString() ?? "");
  const [birthYear, setBirthYear] = useState(
    profile.birth_year?.toString() ?? "",
  );
  const [hideBirthYear, setHideBirthYear] = useState(
    profile.hide_birth_year ?? false,
  );
  const [avatarUrl, setAvatarUrl] = useState<string | null>(
    profile.avatar_url,
  );
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ---- Step 2: Contact ----
  const [phoneMobile, setPhoneMobile] = useState(profile.phone_mobile ?? "");
  const [phoneHome, setPhoneHome] = useState(profile.phone_home ?? "");
  const [phoneWork, setPhoneWork] = useState(profile.phone_work ?? "");
  const [showExtraPhones, setShowExtraPhones] = useState(
    !!(profile.phone_home || profile.phone_work),
  );
  const [hideEmail, setHideEmail] = useState(profile.hide_email ?? false);
  const [hidePhoneMobile, setHidePhoneMobile] = useState(
    profile.hide_phone_mobile ?? false,
  );

  // ---- Step 3: Family ----
  const [familySearchDone, setFamilySearchDone] = useState(false);
  const [familyMatches, setFamilyMatches] = useState<FamilyMatch[]>([]);
  const [selectedFamilyId, setSelectedFamilyId] = useState<string | null>(
    profile.family_id ?? null,
  );
  const [familyDeclined, setFamilyDeclined] = useState(false);
  const [familyResolved, setFamilyResolved] = useState(!!profile.family_id);
  const [pendingMembers, setPendingMembers] = useState<PendingFamilyMember[]>(
    [],
  );
  const [anniversary, setAnniversary] = useState(profile.anniversary ?? "");

  // Which "Add X?" sections are open
  const [addSpouseOpen, setAddSpouseOpen] = useState(false);
  const [addChildOpen, setAddChildOpen] = useState(false);
  const [addParentOpen, setAddParentOpen] = useState(false);
  const [addOtherOpen, setAddOtherOpen] = useState(false);

  // Temp form state for each "Add" section
  const [spouseForm, setSpouseForm] = useState({
    first_name: "",
    last_name: "",
    birth_month: "",
    birth_day: "",
    birth_year: "",
  });
  const [childForm, setChildForm] = useState({
    first_name: "",
    last_name: "",
    birth_month: "",
    birth_day: "",
    birth_year: "",
  });
  const [parentForm, setParentForm] = useState({
    first_name: "",
    last_name: "",
    birth_month: "",
    birth_day: "",
    birth_year: "",
  });
  const [otherForm, setOtherForm] = useState({
    first_name: "",
    last_name: "",
    birth_month: "",
    birth_day: "",
    birth_year: "",
  });

  // ---- Step 4: Optional details ----
  const [occupation, setOccupation] = useState(profile.occupation ?? "");
  const [employer, setEmployer] = useState(profile.employer ?? "");
  const [bio, setBio] = useState(profile.bio ?? "");

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  const initials =
    `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase() || "?";

  const hasSpouseAdded = pendingMembers.some((m) => m.relationship === "spouse");

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingAvatar(true);
    try {
      const url = await uploadImage(
        file,
        "avatar",
        relObjectPath("profiles", profile.id, "avatar"),
      );
      const busted = `${url}?t=${Date.now()}`;
      setAvatarUrl(busted);
      const { error: avatarErr } = await supabase
        .from("profiles")
        .update({ avatar_url: url })
        .eq("id", profile.id);
      if (avatarErr) {
        console.error("avatar update error:", avatarErr);
        toast.error("Photo uploaded but failed to save. Please try again.");
      } else {
        toast.success("Photo uploaded.");
      }
    } catch {
      toast.error("Failed to upload photo.");
    } finally {
      setUploadingAvatar(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const addPendingMember = useCallback(
    (
      rel: FamilyMemberRelationship,
      form: {
        first_name: string;
        last_name: string;
        birth_month: string;
        birth_day: string;
        birth_year: string;
      },
    ) => {
      const name = titleCaseName(form.first_name);
      if (!name) {
        toast.error("First name is required.");
        return false;
      }
      setPendingMembers((prev) => [
        ...prev,
        {
          tempId: crypto.randomUUID(),
          first_name: name,
          last_name: titleCaseName(form.last_name) ?? "",
          birth_month: form.birth_month,
          birth_day: form.birth_day,
          birth_year: form.birth_year,
          relationship: rel,
        },
      ]);
      return true;
    },
    [],
  );

  const removePendingMember = (tempId: string) =>
    setPendingMembers((prev) => prev.filter((m) => m.tempId !== tempId));

  // ---------------------------------------------------------------------------
  // Family resolution
  // ---------------------------------------------------------------------------

  const resolveFamily = async () => {
    if (!lastName.trim()) {
      toast.error("Please enter your last name before searching for a family.");
      return;
    }

    try {
      const res = await fetch("/api/profile/resolve-family", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ last_name: lastName.trim() }),
      });
      if (!res.ok) {
        throw new Error(`resolve-family returned ${res.status}`);
      }
      const json = await res.json();
      setFamilyMatches(json.matches ?? []);
      setFamilySearchDone(true);
    } catch {
      toast.error("Could not search for family. Please try again.");
    }
  };

  const claimFamily = (familyId: string) => {
    setSelectedFamilyId(familyId);
    setFamilyResolved(true);
  };

  const createNewFamily = async () => {
    const name = titleCaseName(lastName.trim());
    if (!name) return;
    const familyName = `${name} Family`;

    const { data, error } = await supabase
      .from("family_units")
      .insert({ family_name: familyName })
      .select("id")
      .single();

    if (error || !data) {
      toast.error("Could not create family. Please try again.");
      return;
    }

    setSelectedFamilyId(data.id);
    setFamilyResolved(true);
    setFamilyDeclined(true);
  };

  // ---------------------------------------------------------------------------
  // Step navigation + validation
  // ---------------------------------------------------------------------------

  const validateStep1 = () => {
    const fn = titleCaseName(firstName);
    const ln = titleCaseName(lastName);
    if (!fn) { toast.error("First name is required."); return false; }
    if (!ln) { toast.error("Last name is required."); return false; }
    if (!birthMonth) { toast.error("Birthday month is required."); return false; }
    if (!birthDay) { toast.error("Birthday day is required."); return false; }
    return true;
  };

  const validateStep2 = () => {
    const hasPhone = !!(phoneMobile || phoneHome || phoneWork);
    const hasVisibleEmail = !hideEmail;
    if (!hasPhone && !hasVisibleEmail) {
      toast.error(
        "Please add a phone number or keep your email visible so others can reach you.",
      );
      return false;
    }
    if (phoneMobile && !normalizePhone(phoneMobile)) {
      toast.error("Mobile phone number isn't valid.");
      return false;
    }
    if (phoneHome && !normalizePhone(phoneHome)) {
      toast.error("Home phone number isn't valid.");
      return false;
    }
    if (phoneWork && !normalizePhone(phoneWork)) {
      toast.error("Work phone number isn't valid.");
      return false;
    }
    return true;
  };

  const validateStep3 = () => {
    if (!familyResolved) {
      toast.error("Please select or create your household before continuing.");
      return false;
    }
    if (hasSpouseAdded && !anniversary) {
      toast.error("Anniversary is required when adding a spouse.");
      return false;
    }
    return true;
  };

  const goNext = async () => {
    if (step === 1 && !validateStep1()) return;
    if (step === 2 && !validateStep2()) return;
    if (step === 3) {
      if (!validateStep3()) return;
      // On step 3 → 4, resolve family on DB
      if (!familyResolved) await resolveFamily();
    }
    setStep((s) => s + 1);
  };

  const goBack = () => setStep((s) => s - 1);

  // ---------------------------------------------------------------------------
  // Final submit
  // ---------------------------------------------------------------------------

  const handleComplete = async () => {
    setSaving(true);
    try {
      const fn = titleCaseName(firstName) ?? "";
      const ln = titleCaseName(lastName) ?? "";

      // Build profile updates
      const profileUpdates: Record<string, unknown> = {
        first_name: fn,
        last_name: ln,
        preferred_name: titleCaseName(preferredName),
        birth_month: birthMonth ? Number(birthMonth) : null,
        birth_day: birthDay ? Number(birthDay) : null,
        birth_year: birthYear ? Number(birthYear) : null,
        hide_birth_year: hideBirthYear,
        phone_mobile: phoneMobile ? normalizePhone(phoneMobile) : null,
        phone_home: phoneHome ? normalizePhone(phoneHome) : null,
        phone_work: phoneWork ? normalizePhone(phoneWork) : null,
        hide_email: hideEmail,
        hide_phone_mobile: hidePhoneMobile,
        family_id: selectedFamilyId,
        occupation: occupation.trim() || null,
        employer: employer.trim() || null,
        bio: bio.trim() || null,
      };

      const { error: profileError } = await supabase
        .from("profiles")
        .update(profileUpdates)
        .eq("id", profile.id);

      if (profileError) throw profileError;

      // Update family anniversary if a spouse was added
      if (selectedFamilyId && hasSpouseAdded && anniversary) {
        await supabase
          .from("family_units")
          .update({ anniversary })
          .eq("id", selectedFamilyId);
      }

      // Create pending family members
      if (selectedFamilyId && pendingMembers.length > 0) {
        const rows = pendingMembers.map((m) => ({
          family_id: selectedFamilyId,
          first_name: m.first_name,
          last_name: m.last_name || null,
          birth_month: m.birth_month ? Number(m.birth_month) : null,
          birth_day: m.birth_day ? Number(m.birth_day) : null,
          birth_year: m.birth_year ? Number(m.birth_year) : null,
          relationship: m.relationship,
          is_class_member: false,
        }));

        const { error: membersError } = await supabase
          .from("family_members")
          .insert(rows);

        if (membersError) throw membersError;
      }

      // Mark setup complete only after all dependent writes succeed
      const { error: setupError } = await supabase
        .from("profiles")
        .update({ setup_completed: true })
        .eq("id", profile.id);

      if (setupError) throw setupError;

      toast.success("Profile setup complete! Welcome to the directory.");
      router.push("/directory");
    } catch (err) {
      console.error(err);
      toast.error("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Progress indicator */}
      <div className="flex items-center justify-between mb-2">
        {STEP_LABELS.map((label, i) => {
          const num = i + 1;
          const done = num < step;
          const active = num === step;
          return (
            <div key={num} className="flex-1 flex flex-col items-center">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors
                  ${done ? "bg-brand-primary text-white" : active ? "bg-brand-primary text-white ring-4 ring-brand-primary/20" : "bg-muted text-muted-foreground"}`}
              >
                {done ? <Check className="h-4 w-4" /> : num}
              </div>
              <span
                className={`text-base mt-1 text-center hidden sm:block ${active ? "text-brand-primary font-medium" : "text-muted-foreground"}`}
              >
                {label}
              </span>
              {i < STEP_LABELS.length - 1 && (
                <div className="absolute" />
              )}
            </div>
          );
        })}
      </div>

      {/* ======================================================
          STEP 1: Who are you?
          ====================================================== */}
      {step === 1 && (
        <Card>
          <CardContent className="pt-6 space-y-6">
            <div>
              <h2 className="text-xl font-semibold mb-1">Who are you?</h2>
              <p className="text-base text-muted-foreground">
                This is how you&apos;ll appear in the member directory.
              </p>
            </div>

            {/* Avatar upload */}
            <div className="flex items-center gap-5">
              <div className="relative">
                <Avatar className="h-20 w-20">
                  {avatarUrl && (
                    <AvatarImage src={avatarUrl} alt="Profile photo" />
                  )}
                  <AvatarFallback className="text-xl bg-brand-primary text-white">
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
                <p className="text-sm font-medium">Profile photo</p>
                <p className="text-base text-muted-foreground">
                  {uploadingAvatar
                    ? "Uploading..."
                    : "Optional — click the camera icon to add one."}
                </p>
              </div>
            </div>

            <Separator />

            {/* Name fields */}
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="first_name" className="text-base">
                  First name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="first_name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  onBlur={(e) =>
                    setFirstName(titleCaseName(e.target.value) ?? "")
                  }
                  placeholder="First name"
                  className="text-base py-5"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="last_name" className="text-base">
                  Last name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="last_name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  onBlur={(e) =>
                    setLastName(titleCaseName(e.target.value) ?? "")
                  }
                  placeholder="Last name"
                  className="text-base py-5"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="preferred_name" className="text-base">
                Preferred name / nickname{" "}
                <span className="text-muted-foreground font-normal text-sm">
                  (optional)
                </span>
              </Label>
              <Input
                id="preferred_name"
                value={preferredName}
                onChange={(e) => setPreferredName(e.target.value)}
                onBlur={(e) =>
                  setPreferredName(titleCaseName(e.target.value) ?? "")
                }
                placeholder="e.g. Bobby, Sue"
                className="text-base py-5"
              />
            </div>

            <Separator />

            {/* Birthday */}
            <div className="space-y-2">
              <Label className="text-base">
                Birthday <span className="text-destructive">*</span>
              </Label>
              <p className="text-sm text-muted-foreground">
                Month and day are required. Year is optional.
              </p>
              <div className="grid grid-cols-[1.6fr_1fr_1fr] gap-3">
                <Select
                  items={MONTHS}
                  value={birthMonth}
                  onValueChange={(v) => setBirthMonth(v ?? "")}
                >
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
                <Input
                  type="number"
                  min="1"
                  max="31"
                  placeholder="Day"
                  value={birthDay}
                  onChange={(e) => setBirthDay(e.target.value)}
                  className="text-base py-5"
                />
                <Input
                  type="number"
                  min="1900"
                  max="2100"
                  placeholder="Year"
                  value={birthYear}
                  onChange={(e) => setBirthYear(e.target.value)}
                  className="text-base py-5"
                />
              </div>
              {birthYear && (
                <div className="flex items-center gap-3 mt-2">
                  <Switch
                    id="hide_birth_year"
                    checked={hideBirthYear}
                    onCheckedChange={setHideBirthYear}
                  />
                  <Label
                    htmlFor="hide_birth_year"
                    className="text-sm cursor-pointer"
                  >
                    Hide my birth year (show month/day only)
                  </Label>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ======================================================
          STEP 2: How to reach you
          ====================================================== */}
      {step === 2 && (
        <Card>
          <CardContent className="pt-6 space-y-6">
            <div>
              <h2 className="text-xl font-semibold mb-1">
                How can we reach you?
              </h2>
              <p className="text-sm text-muted-foreground">
                Contact info is only visible to other members, not the public.
              </p>
            </div>

            {/* Mobile phone */}
            <div className="space-y-2">
              <Label htmlFor="phone_mobile" className="text-base">
                Mobile phone{" "}
                <span className="text-muted-foreground font-normal text-sm">
                  (recommended)
                </span>
              </Label>
              <Input
                id="phone_mobile"
                type="tel"
                inputMode="tel"
                value={phoneMobile}
                onChange={(e) =>
                  setPhoneMobile(formatPhoneAsYouType(e.target.value))
                }
                placeholder="(555) 123-4567"
                className="text-base py-5"
              />
              <div className="flex items-center gap-3 mt-1">
                <Switch
                  id="hide_phone_mobile"
                  checked={hidePhoneMobile}
                  onCheckedChange={setHidePhoneMobile}
                />
                <Label
                  htmlFor="hide_phone_mobile"
                  className="text-sm cursor-pointer"
                >
                  Hide mobile phone from directory
                </Label>
              </div>
            </div>

            {/* Email (read-only) */}
            <div className="space-y-2">
              <Label className="text-base">Email</Label>
              <Input
                value={userEmail}
                disabled
                className="text-base py-5 bg-muted"
              />
              <div className="flex items-center gap-3">
                <Switch
                  id="hide_email"
                  checked={hideEmail}
                  onCheckedChange={setHideEmail}
                />
                <Label htmlFor="hide_email" className="text-sm cursor-pointer">
                  Hide email from directory
                </Label>
              </div>
              <p className="text-xs text-muted-foreground">
                To change your login email, contact an admin.
              </p>
            </div>

            {/* Extra phones toggle */}
            {!showExtraPhones ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowExtraPhones(true)}
                className="flex items-center gap-2"
              >
                <Plus className="h-4 w-4" />
                Add home or work phone
              </Button>
            ) : (
              <>
                <Separator />
                <div className="space-y-2">
                  <Label htmlFor="phone_home" className="text-base">
                    Home phone{" "}
                    <span className="text-muted-foreground font-normal text-sm">
                      (optional)
                    </span>
                  </Label>
                  <Input
                    id="phone_home"
                    type="tel"
                    inputMode="tel"
                    value={phoneHome}
                    onChange={(e) =>
                      setPhoneHome(formatPhoneAsYouType(e.target.value))
                    }
                    placeholder="(555) 123-4567"
                    className="text-base py-5"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone_work" className="text-base">
                    Work phone{" "}
                    <span className="text-muted-foreground font-normal text-sm">
                      (optional)
                    </span>
                  </Label>
                  <Input
                    id="phone_work"
                    type="tel"
                    inputMode="tel"
                    value={phoneWork}
                    onChange={(e) =>
                      setPhoneWork(formatPhoneAsYouType(e.target.value))
                    }
                    placeholder="(555) 123-4567"
                    className="text-base py-5"
                  />
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* ======================================================
          STEP 3: Your household
          ====================================================== */}
      {step === 3 && (
        <Card>
          <CardContent className="pt-6 space-y-6">
            <div>
              <h2 className="text-xl font-semibold mb-1">Your household</h2>
              <p className="text-sm text-muted-foreground">
                We&apos;ll use your last name to find or create your family in
                the directory.
              </p>
            </div>

            {/* Family resolution */}
            {!familyResolved ? (
              <div className="space-y-4">
                {!familySearchDone ? (
                  <Button
                    type="button"
                    onClick={resolveFamily}
                    className="bg-brand-primary hover:bg-brand-primary/90 text-white"
                  >
                    <Users className="h-4 w-4 mr-2" />
                    Search for a {titleCaseName(lastName) ?? lastName} Family
                  </Button>
                ) : familyMatches.length > 0 ? (
                  <div className="space-y-3">
                    <p className="text-sm font-medium">
                      We found{" "}
                      {familyMatches.length === 1 ? "a match" : "some matches"}{" "}
                      — is one of these your household?
                    </p>
                    {familyMatches.map((match) => (
                      <div
                        key={match.id}
                        className="border rounded-lg p-4 space-y-2"
                      >
                        <p className="font-semibold">{match.family_name}</p>
                        <div className="flex flex-wrap gap-1">
                          {match.members.map((m, i) => (
                            <Badge key={i} variant="secondary" className="text-xs">
                              {m.name}
                            </Badge>
                          ))}
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => claimFamily(match.id)}
                          className="bg-brand-primary hover:bg-brand-primary/90 text-white"
                        >
                          Yes, this is my family
                        </Button>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={createNewFamily}
                    >
                      None of these — create a new household
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      No existing household found for &ldquo;
                      {titleCaseName(lastName) ?? lastName} Family&rdquo;. We&apos;ll
                      create one for you.
                    </p>
                    <Button
                      type="button"
                      onClick={createNewFamily}
                      className="bg-brand-primary hover:bg-brand-primary/90 text-white"
                    >
                      Create {titleCaseName(lastName) ?? lastName} Family
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-lg bg-brand-bg-light border border-brand-primary/20 p-4 flex items-center gap-3">
                <Check className="h-5 w-5 text-brand-primary shrink-0" />
                <div>
                  <p className="font-medium text-brand-primary">
                    {familyDeclined
                      ? `Created a new household for you`
                      : `Joined your existing household`}
                  </p>
                  <p className="text-sm text-brand-primary-light">
                    {titleCaseName(lastName) ?? lastName} Family
                  </p>
                </div>
              </div>
            )}

            {/* Family member additions — only show after family is resolved */}
            {familyResolved && (
              <div className="space-y-4">
                <Separator />
                <p className="text-sm font-medium text-muted-foreground">
                  Add family members to your household (optional)
                </p>

                {/* Existing pending members list */}
                {pendingMembers.length > 0 && (
                  <div className="space-y-2">
                    {pendingMembers.map((m) => (
                      <div
                        key={m.tempId}
                        className="flex items-center justify-between rounded-md border px-3 py-2 text-base"
                      >
                        <span>
                          <span className="font-medium">
                            {m.first_name} {m.last_name}
                          </span>{" "}
                          <span className="text-muted-foreground capitalize">
                            — {m.relationship}
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={() => removePendingMember(m.tempId)}
                          className="text-muted-foreground hover:text-destructive"
                          aria-label="Remove"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Spouse */}
                {!addSpouseOpen && !hasSpouseAdded ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setAddSpouseOpen(true)}
                    className="flex items-center gap-2"
                  >
                    <Plus className="h-4 w-4" />
                    Add spouse
                  </Button>
                ) : addSpouseOpen ? (
                  <MemberAddForm
                    title="Add spouse"
                    form={spouseForm}
                    setForm={setSpouseForm}
                    relationship="spouse"
                    lastNameFallback={lastName}
                    onAdd={addPendingMember}
                    onAdded={() => {
                      setAddSpouseOpen(false);
                      setSpouseForm({
                        first_name: "",
                        last_name: "",
                        birth_month: "",
                        birth_day: "",
                        birth_year: "",
                      });
                    }}
                    onCancel={() => setAddSpouseOpen(false)}
                  />
                ) : null}

                {/* Anniversary — auto-appears when a spouse is added */}
                {hasSpouseAdded && (
                  <div className="space-y-2">
                    <Label htmlFor="anniversary" className="text-base">
                      Anniversary{" "}
                      <span className="text-destructive text-sm">*</span>
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Required when adding a spouse.
                    </p>
                    <Input
                      id="anniversary"
                      type="date"
                      value={anniversary}
                      onChange={(e) => setAnniversary(e.target.value)}
                      className="text-base py-5"
                    />
                  </div>
                )}

                {/* Children */}
                {!addChildOpen ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setAddChildOpen(true)}
                    className="flex items-center gap-2"
                  >
                    <Plus className="h-4 w-4" />
                    Add child
                  </Button>
                ) : (
                  <MemberAddForm
                    title="Add child"
                    form={childForm}
                    setForm={setChildForm}
                    relationship="child"
                    lastNameFallback={lastName}
                    onAdd={addPendingMember}
                    onAdded={() => {
                      setAddChildOpen(false);
                      setChildForm({
                        first_name: "",
                        last_name: "",
                        birth_month: "",
                        birth_day: "",
                        birth_year: "",
                      });
                    }}
                    onCancel={() => setAddChildOpen(false)}
                  />
                )}

                {/* Parents */}
                {!addParentOpen ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setAddParentOpen(true)}
                    className="flex items-center gap-2"
                  >
                    <Plus className="h-4 w-4" />
                    Add parent
                  </Button>
                ) : (
                  <MemberAddForm
                    title="Add parent"
                    form={parentForm}
                    setForm={setParentForm}
                    relationship="parent"
                    lastNameFallback={lastName}
                    onAdd={addPendingMember}
                    onAdded={() => {
                      setAddParentOpen(false);
                      setParentForm({
                        first_name: "",
                        last_name: "",
                        birth_month: "",
                        birth_day: "",
                        birth_year: "",
                      });
                    }}
                    onCancel={() => setAddParentOpen(false)}
                  />
                )}

                {/* Other */}
                {!addOtherOpen ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setAddOtherOpen(true)}
                    className="flex items-center gap-2"
                  >
                    <Plus className="h-4 w-4" />
                    Add other family member
                  </Button>
                ) : (
                  <MemberAddForm
                    title="Add other family member"
                    form={otherForm}
                    setForm={setOtherForm}
                    relationship="other"
                    lastNameFallback={lastName}
                    onAdd={addPendingMember}
                    onAdded={() => {
                      setAddOtherOpen(false);
                      setOtherForm({
                        first_name: "",
                        last_name: "",
                        birth_month: "",
                        birth_day: "",
                        birth_year: "",
                      });
                    }}
                    onCancel={() => setAddOtherOpen(false)}
                  />
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ======================================================
          STEP 4: About you (optional)
          ====================================================== */}
      {step === 4 && (
        <Card>
          <CardContent className="pt-6 space-y-6">
            <div>
              <h2 className="text-xl font-semibold mb-1">
                A little more about you
              </h2>
              <p className="text-sm text-muted-foreground">
                All fields here are optional. These show on your directory
                profile and help others in the group get to know you.
              </p>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="occupation" className="text-base">
                  Occupation
                </Label>
                <Input
                  id="occupation"
                  value={occupation}
                  onChange={(e) => setOccupation(e.target.value)}
                  placeholder="e.g. Teacher, Plumber"
                  className="text-base py-5"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="employer" className="text-base">
                  Employer
                </Label>
                <Input
                  id="employer"
                  value={employer}
                  onChange={(e) => setEmployer(e.target.value)}
                  placeholder="Company or organization"
                  className="text-base py-5"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="bio" className="text-base">
                About me
              </Label>
              <Textarea
                id="bio"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={4}
                placeholder="A sentence or two about yourself..."
                className="text-base"
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Navigation buttons */}
      <div className="flex justify-between items-center">
        {step > 1 ? (
          <Button
            type="button"
            variant="outline"
            onClick={goBack}
            className="flex items-center gap-2"
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </Button>
        ) : (
          <div />
        )}

        {step < 4 ? (
          <Button
            type="button"
            onClick={goNext}
            className="flex items-center gap-2 bg-brand-primary hover:bg-brand-primary/90 text-white"
          >
            Continue
            <ChevronRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            type="button"
            onClick={handleComplete}
            disabled={saving}
            className="bg-brand-primary hover:bg-brand-primary/90 text-white flex items-center gap-2"
          >
            {saving ? "Saving..." : "Complete Setup"}
            {!saving && <Check className="h-4 w-4" />}
          </Button>
        )}
      </div>
    </div>
  );
}
