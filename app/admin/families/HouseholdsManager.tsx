"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { deleteImage, mintSignedUrl, uploadImage } from "@/lib/uploadImage";
import { relObjectPath } from "@/lib/storagePaths";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { toast } from "sonner";
import { failureMessage } from "@/lib/errorCopy";
import { Camera, Home, Plus, Pencil, Search, Trash2, Users, X } from "lucide-react";
import type { FamilyUnit, Profile, FamilyMember, FamilyMemberRelationship } from "@/lib/types";
import { titleCaseName, formatPhone, formatPhoneAsYouType } from "@/lib/sanitize";
import { displayName } from "@/lib/names";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/states/EmptyState";
import { ErrorState } from "@/components/states/ErrorState";
import { LoadingState } from "@/components/states/LoadingState";
import { FieldError, invalidFieldProps } from "@/components/ui/field-error";
import { matchesSearch } from "@/components/admin/adminSearch";
import {
  HOUSEHOLD_FIELDS,
  validateHousehold,
  type HouseholdErrors,
  type HouseholdField,
  type HouseholdFormState,
} from "./householdForm";

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

interface FamilyWithMembers extends FamilyUnit {
  members: Pick<Profile, "id" | "first_name" | "last_name" | "preferred_name">[];
}

const FIELD_IDS: Record<HouseholdField, string> = {
  family_name: "family_name",
  state: "f_state",
  postal_code: "f_zip",
  phone_home: "f_phone",
};

const EMPTY_FORM: HouseholdFormState = {
  family_name: "",
  address_line1: "",
  address_line2: "",
  city: "",
  state: "",
  postal_code: "",
  phone_home: "",
  anniversary: "",
  hide_address: false,
  hide_phone_home: false,
};

function fromFamily(f: FamilyUnit): HouseholdFormState {
  return {
    family_name: f.family_name,
    address_line1: f.address_line1 || "",
    address_line2: f.address_line2 || "",
    city: f.city || "",
    state: f.state || "",
    postal_code: f.postal_code || "",
    phone_home: formatPhone(f.phone_home),
    anniversary: f.anniversary || "",
    hide_address: f.hide_address,
    hide_phone_home: f.hide_phone_home,
  };
}

interface FamilyMemberFormState {
  first_name: string;
  last_name: string;
  relationship: FamilyMemberRelationship;
  birth_month: string;
  birth_day: string;
  birth_year: string;
}

const EMPTY_MEMBER_FORM: FamilyMemberFormState = {
  first_name: "",
  last_name: "",
  relationship: "child",
  birth_month: "",
  birth_day: "",
  birth_year: "",
};

export function HouseholdsManager() {
  const [families, setFamilies] = useState<FamilyWithMembers[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [query, setQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<FamilyUnit | null>(null);
  const [deletingFamily, setDeletingFamily] = useState<FamilyWithMembers | null>(null);
  const [removingMember, setRemovingMember] = useState<FamilyMember | null>(null);
  const [form, setForm] = useState<HouseholdFormState>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<HouseholdErrors>({});
  const [memberNameError, setMemberNameError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  const [familyMembers, setFamilyMembers] = useState<FamilyMember[]>([]);
  // The household whose members `familyMembers` holds; delete stays disabled
  // until it matches, so the confirm never counts another household's people.
  const [membersFamilyId, setMembersFamilyId] = useState<string | null>(null);
  const membersRequestRef = useRef(0);
  const [memberForm, setMemberForm] = useState<FamilyMemberFormState>(EMPTY_MEMBER_FORM);
  const [editingMember, setEditingMember] = useState<FamilyMember | null>(null);
  const [showMemberForm, setShowMemberForm] = useState(false);
  const [savingMember, setSavingMember] = useState(false);

  // Edit mode only: the photo's path needs the family id.
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [removingPhoto, setRemovingPhoto] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  // Monotonic token for async photo-URL mints: each mint captures the token
  // at issue time and applies its result only if still current, so a stale
  // signing request can never overwrite a later family's photo (or a
  // just-uploaded/removed one).
  const photoRequestRef = useRef(0);

  const loadedOnce = useRef(false);
  const supabase = useMemo(() => createClient(), []);

  const loadFamilies = useCallback(async () => {
    const [
      { data: familyData, error: familyErr },
      { data: memberData, error: memberErr },
    ] = await Promise.all([
      supabase.from("family_units").select("*").order("family_name"),
      supabase
        .from("profiles")
        .select("id, first_name, last_name, preferred_name, family_id")
        .not("family_id", "is", null),
    ]);

    if (familyErr || memberErr) {
      console.error("Failed to load households:", familyErr ?? memberErr);
      if (loadedOnce.current) toast.error(failureMessage("load the latest households"));
      else setStatus("failed");
      return;
    }
    loadedOnce.current = true;

    const byFamily: Record<string, FamilyWithMembers["members"]> = {};
    (memberData || []).forEach((m) => {
      if (!m.family_id) return;
      (byFamily[m.family_id] ??= []).push({
        id: m.id,
        first_name: m.first_name,
        last_name: m.last_name,
        preferred_name: m.preferred_name,
      });
    });

    setFamilies(
      (familyData || []).map((f) => ({
        ...f,
        members: byFamily[f.id] || [],
      })),
    );
    setStatus("ready");
  }, [supabase]);

  useEffect(() => {
    loadFamilies();
  }, [loadFamilies]);

  async function loadFamilyMembers(familyId: string) {
    const requestId = ++membersRequestRef.current;
    setMembersFamilyId(null);
    const { data, error } = await supabase
      .from("family_members")
      .select("*")
      .eq("family_id", familyId)
      .order("relationship");

    if (membersRequestRef.current !== requestId) return;
    if (error) {
      toast.error(failureMessage("load the household's members"));
      return;
    }
    setFamilyMembers((data || []) as FamilyMember[]);
    setMembersFamilyId(familyId);
  }

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormErrors({});
    photoRequestRef.current++; // invalidate any in-flight mint
    setPhotoUrl(null);
    membersRequestRef.current++; // invalidate any in-flight load
    setFamilyMembers([]);
    setMembersFamilyId(null);
    setShowMemberForm(false);
    setEditingMember(null);
    setMemberForm(EMPTY_MEMBER_FORM);
    setDialogOpen(true);
  }

  function openEdit(family: FamilyUnit) {
    setEditing(family);
    setForm(fromFamily(family));
    setFormErrors({});
    // The stored value is a private-bucket public URL — exchange it
    // for a signed URL before it reaches an <img src>.
    const requestId = ++photoRequestRef.current;
    setPhotoUrl(null);
    if (family.photo_url) {
      mintSignedUrl(family.photo_url)
        .then((url) => {
          // Apply only if this is still the newest photo request — the
          // dialog may have moved to a different family, been closed, or the
          // photo replaced/removed while the mint was in flight.
          if (photoRequestRef.current === requestId) setPhotoUrl(url);
        })
        .catch((err) => {
          console.error("openEdit: signing family photo failed", err);
        });
    }
    setFamilyMembers([]);
    setMembersFamilyId(null);
    setShowMemberForm(false);
    setEditingMember(null);
    setMemberForm(EMPTY_MEMBER_FORM);
    setDialogOpen(true);
    loadFamilyMembers(family.id);
  }

  async function handleSave() {
    const { errors, payload } = validateHousehold(form);
    setFormErrors(errors);
    const firstInvalid = HOUSEHOLD_FIELDS.find((field) => errors[field]);
    if (firstInvalid) {
      document.getElementById(FIELD_IDS[firstInvalid])?.focus();
      return;
    }

    setSaving(true);
    const { error } = editing
      ? await supabase
          .from("family_units")
          .update(payload)
          .eq("id", editing.id)
      : await supabase.from("family_units").insert(payload);
    setSaving(false);

    if (error) {
      console.error(error);
      toast.error(failureMessage("save the household"));
      return;
    }

    toast.success(editing ? "Household saved." : "Household added.");
    setDialogOpen(false);
    loadFamilies();
  }

  async function handleDelete(family: FamilyWithMembers) {
    const { error } = await supabase
      .from("family_units")
      .delete()
      .eq("id", family.id);
    if (error) {
      toast.error(failureMessage("delete the household"));
      return;
    }
    toast.success("Household deleted.");
    setDeletingFamily(null);
    setDialogOpen(false);
    loadFamilies();
  }

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !editing) return;

    setUploadingPhoto(true);
    try {
      const url = await uploadImage(
        file,
        "family",
        relObjectPath("families", editing.id, "photo"),
      );
      const { error } = await supabase
        .from("family_units")
        .update({ photo_url: url })
        .eq("id", editing.id);
      if (error) throw error;
      // A freshly minted signed URL is already unique (its token), so the
      // new image shows immediately — no manual cache-busting needed.
      const requestId = ++photoRequestRef.current;
      const signed = await mintSignedUrl(url);
      if (photoRequestRef.current === requestId) setPhotoUrl(signed);
      toast.success("Household photo updated.");
      loadFamilies();
    } catch (err) {
      console.error(err);
      toast.error(failureMessage("upload the household photo"));
    } finally {
      setUploadingPhoto(false);
      if (photoInputRef.current) photoInputRef.current.value = "";
    }
  }

  async function handlePhotoRemove() {
    if (!editing) return;
    setRemovingPhoto(true);
    try {
      // Delete the file first — removing a missing object doesn't error, so
      // a retry after a failed DB update stays safe. That same non-error
      // also means a legacy photo still keyed at the un-prefixed
      // `families/<id>/photo.jpg` (pre-org-partitioning) is silently left behind as
      // an orphan blob: RLS filters it from the org-prefixed remove(), the
      // photo_url update below still clears the UI, and
      // scripts/rekey-storage-objects.mjs is what re-keys the estate.
      try {
        await deleteImage("family", relObjectPath("families", editing.id, "photo"));
      } catch {
        toast.error(failureMessage("remove the household photo"));
        return;
      }
      const { error } = await supabase
        .from("family_units")
        .update({ photo_url: null })
        .eq("id", editing.id);
      if (error) {
        toast.error(failureMessage("remove the household photo"));
        return;
      }
      photoRequestRef.current++; // invalidate any in-flight mint
      setPhotoUrl(null);
      toast.success("Household photo removed.");
      loadFamilies();
    } finally {
      setRemovingPhoto(false);
    }
  }

  function closeMemberForm() {
    setShowMemberForm(false);
    setEditingMember(null);
    setMemberForm(EMPTY_MEMBER_FORM);
    setMemberNameError(undefined);
  }

  function startAddMember() {
    setMemberNameError(undefined);
    setEditingMember(null);
    setMemberForm(EMPTY_MEMBER_FORM);
    setShowMemberForm(true);
  }

  function startEditMember(fm: FamilyMember) {
    setMemberNameError(undefined);
    setEditingMember(fm);
    setMemberForm({
      first_name: fm.first_name,
      last_name: fm.last_name || "",
      relationship: fm.relationship,
      birth_month: fm.birth_month?.toString() || "",
      birth_day: fm.birth_day?.toString() || "",
      birth_year: fm.birth_year?.toString() || "",
    });
    setShowMemberForm(true);
  }

  async function handleSaveMember() {
    if (!editing) return;
    const firstName = titleCaseName(memberForm.first_name);
    if (!firstName) {
      setMemberNameError("Enter a first name.");
      document.getElementById("fm_first")?.focus();
      return;
    }
    setMemberNameError(undefined);

    const payload = {
      family_id: editing.id,
      first_name: firstName,
      last_name: titleCaseName(memberForm.last_name) || null,
      relationship: memberForm.relationship,
      birth_month: memberForm.birth_month ? Number(memberForm.birth_month) : null,
      birth_day: memberForm.birth_day ? Number(memberForm.birth_day) : null,
      birth_year: memberForm.birth_year ? Number(memberForm.birth_year) : null,
    };

    setSavingMember(true);
    if (editingMember) {
      const res = await fetch(`/api/admin/family-members/${editingMember.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).catch(() => null);
      if (!res?.ok) {
        toast.error(failureMessage(`save ${firstName}`, res ? res.status : "network"));
        setSavingMember(false);
        return;
      }
      toast.success(`${firstName} saved.`);
    } else {
      const res = await fetch("/api/admin/family-members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).catch(() => null);
      if (!res?.ok) {
        toast.error(failureMessage(`add ${firstName}`, res ? res.status : "network"));
        setSavingMember(false);
        return;
      }
      toast.success(`${firstName} added.`);
    }
    setSavingMember(false);
    closeMemberForm();
    loadFamilyMembers(editing.id);
  }

  async function handleDeleteMember(fm: FamilyMember) {
    const res = await fetch(`/api/admin/family-members/${fm.id}`, {
      method: "DELETE",
    }).catch(() => null);
    if (!res?.ok) {
      toast.error(
        failureMessage(`remove ${fm.first_name}`, res ? res.status : "network"),
      );
      // The request may have reached the server before the connection dropped.
      if (!res) {
        setRemovingMember(null);
        if (editing) loadFamilyMembers(editing.id);
      }
      return;
    }
    toast.success(`Removed ${fm.first_name} from the household.`);
    setRemovingMember(null);
    if (editing) loadFamilyMembers(editing.id);
  }

  const header = (
    <PageHeader
      title="Households"
      subtitle="People who live together share an address and home phone in the directory."
      actions={
        <Button size="lg" onClick={openCreate}>
          <Plus className="mr-2 h-5 w-5" aria-hidden="true" />
          Add household
        </Button>
      }
    />
  );

  if (status !== "ready") {
    return (
      <PageContainer>
        {header}
        {status === "loading" ? (
          <LoadingState thing="households" />
        ) : (
          <ErrorState
            thing="households"
            onRetry={() => {
              setStatus("loading");
              loadFamilies();
            }}
          />
        )}
      </PageContainer>
    );
  }

  const shownFamilies = families.filter((f) =>
    matchesSearch(query, [f.family_name, f.city, f.address_line1, ...f.members.map(displayName)]),
  );

  return (
    <PageContainer>
      {header}

      {families.length === 0 ? (
        <EmptyState
          icon={Home}
          message="No households yet."
          action={
            <Button onClick={openCreate}>
              <Plus aria-hidden="true" />
              Add household
            </Button>
          }
        />
      ) : (
        <>
          <div className="mb-6 max-w-md space-y-2">
            <Label htmlFor="household-search" className="text-base">
              Search households
            </Label>
            <div className="relative">
              <Search
                className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id="household-search"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Household, member or address"
                autoComplete="off"
                className="pl-10 text-base"
              />
            </div>
            {query.trim() && (
              <p role="status" className="text-base text-muted-foreground">
                {shownFamilies.length} of {families.length} households
              </p>
            )}
          </div>
          {shownFamilies.length === 0 ? (
            <EmptyState
              icon={Search}
              message="No households match that search."
              action={
                <Button variant="outline" onClick={() => setQuery("")}>
                  Clear search
                </Button>
              }
            />
          ) : (
            <div className="space-y-3">
              {shownFamilies.map((family) => (
                <Card key={family.id}>
                  <CardContent>
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <p className="text-xl font-semibold">{family.family_name}</p>
                        {family.address_line1 && (
                          <p className="text-base text-muted-foreground mt-1">
                            {family.address_line1}
                            {family.address_line2 && `, ${family.address_line2}`}
                            {family.city && `, ${family.city}`}
                            {family.state && `, ${family.state}`}
                            {family.postal_code && ` ${family.postal_code}`}
                          </p>
                        )}
                        {family.phone_home && (
                          <p className="text-base text-muted-foreground">
                            {formatPhone(family.phone_home)}
                          </p>
                        )}
                        <div className="flex items-center gap-1 mt-2 text-base text-muted-foreground">
                          <Users className="h-5 w-5" aria-hidden="true" />
                          <span>
                            {family.members.length}{" "}
                            {family.members.length === 1 ? "member" : "members"}
                          </span>
                        </div>
                        {family.members.length > 0 && (
                          <ul className="mt-1 text-base">
                            {family.members.map((m) => (
                              <li key={m.id}>
                                <Link
                                  href={`/admin/members/${m.id}`}
                                  className="inline-flex min-h-11 items-center text-brand-primary-text underline underline-offset-4 hover:text-foreground"
                                >
                                  {displayName(m)}
                                </Link>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <Button
                          variant="outline"
                          className="w-full sm:w-auto"
                          onClick={() => openEdit(family)}
                          aria-label={`Edit ${family.family_name}`}
                        >
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                          Edit
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit household" : "Add household"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="family_name">Household name</Label>
              <Input
                id="family_name"
                value={form.family_name}
                onChange={(e) =>
                  setForm({ ...form, family_name: e.target.value })
                }
                placeholder="The Okafor family"
                {...invalidFieldProps("family_name", formErrors.family_name)}
              />
              <FieldError fieldId="family_name" message={formErrors.family_name} />
            </div>

            {editing && (
              <div className="space-y-2">
                <Label>Household photo</Label>
                {photoUrl ? (
                  <div className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={photoUrl}
                      alt={`${form.family_name} household photo`}
                      className="w-full aspect-[4/3] object-cover rounded-lg"
                    />
                    <div className="absolute bottom-2 right-2 flex gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={uploadingPhoto || removingPhoto}
                        onClick={() => photoInputRef.current?.click()}
                      >
                        <Camera className="mr-1 h-4 w-4" />
                        {uploadingPhoto ? "Uploading…" : "Replace photo"}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={uploadingPhoto || removingPhoto}
                        onClick={handlePhotoRemove}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                        <span className="sr-only">Remove photo</span>
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={uploadingPhoto}
                    onClick={() => photoInputRef.current?.click()}
                  >
                    <Camera className="mr-1 h-4 w-4" />
                    {uploadingPhoto ? "Uploading…" : "Add photo"}
                  </Button>
                )}
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoUpload}
                  className="hidden"
                />
                <p className="text-base text-muted-foreground">
                  Shown on the household&apos;s directory card in place of
                  individual avatars.
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="f_address1">Street address</Label>
              <Input
                id="f_address1"
                value={form.address_line1}
                onChange={(e) =>
                  setForm({ ...form, address_line1: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="f_address2">Apt / unit</Label>
              <Input
                id="f_address2"
                value={form.address_line2}
                onChange={(e) =>
                  setForm({ ...form, address_line2: e.target.value })
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
              <div className="col-span-2 space-y-2 sm:col-span-3">
                <Label htmlFor="f_city">City</Label>
                <Input
                  id="f_city"
                  value={form.city}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                />
              </div>
              <div className="space-y-2 sm:col-span-1">
                <Label htmlFor="f_state">State</Label>
                <Input
                  id="f_state"
                  value={form.state}
                  onChange={(e) =>
                    setForm({ ...form, state: e.target.value.toUpperCase() })
                  }
                  maxLength={2}
                  className="uppercase"
                  {...invalidFieldProps("f_state", formErrors.state)}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="f_zip">ZIP</Label>
                <Input
                  id="f_zip"
                  value={form.postal_code}
                  onChange={(e) =>
                    setForm({ ...form, postal_code: e.target.value })
                  }
                  {...invalidFieldProps("f_zip", formErrors.postal_code)}
                />
              </div>
              <div className="col-span-2 sm:col-span-6">
                <FieldError fieldId="f_state" message={formErrors.state} />
                <FieldError fieldId="f_zip" message={formErrors.postal_code} />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="f_phone">Home phone</Label>
              <Input
                id="f_phone"
                type="tel"
                value={form.phone_home}
                onChange={(e) =>
                  setForm({
                    ...form,
                    phone_home: formatPhoneAsYouType(e.target.value),
                  })
                }
                placeholder="(555) 123-4567"
                {...invalidFieldProps("f_phone", formErrors.phone_home)}
              />
              <FieldError fieldId="f_phone" message={formErrors.phone_home} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="f_anniversary">Anniversary</Label>
              <Input
                id="f_anniversary"
                type="date"
                value={form.anniversary}
                onChange={(e) =>
                  setForm({ ...form, anniversary: e.target.value })
                }
              />
              <p className="text-base text-muted-foreground">
                Shown on the household&apos;s directory card only when a spouse is listed.
              </p>
            </div>

            <div className="border-t pt-4 space-y-3">
              <p className="text-base font-semibold">Household privacy</p>
              <div className="flex items-center justify-between">
                <Label htmlFor="f_hide_addr">Hide address</Label>
                <Switch
                  id="f_hide_addr"
                  checked={form.hide_address}
                  onCheckedChange={(v) =>
                    setForm({ ...form, hide_address: v })
                  }
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="f_hide_phone">Hide home phone</Label>
                <Switch
                  id="f_hide_phone"
                  checked={form.hide_phone_home}
                  onCheckedChange={(v) =>
                    setForm({ ...form, hide_phone_home: v })
                  }
                />
              </div>
            </div>

            {editing && (
              <>
                <Separator />
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-base font-semibold">Listed without an account</p>
                    {!showMemberForm && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={startAddMember}
                      >
                        <Plus aria-hidden="true" />
                        Add someone
                      </Button>
                    )}
                  </div>

                  {familyMembers.length > 0 && (
                    <ul className="space-y-2 mb-3">
                      {familyMembers.map((fm) => (
                        <li
                          key={fm.id}
                          className="flex items-center justify-between gap-2 text-base bg-muted/40 rounded-md px-3 py-2"
                        >
                          <div>
                            <span className="font-medium">
                              {fm.first_name}
                              {fm.last_name && ` ${fm.last_name}`}
                            </span>
                            <span className="text-muted-foreground ml-2">
                              · {RELATIONSHIPS.find((r) => r.value === fm.relationship)?.label}
                            </span>
                            {fm.birth_month && fm.birth_day && (
                              <span className="text-muted-foreground ml-2">
                                · {MONTHS[fm.birth_month - 1]?.label} {fm.birth_day}
                              </span>
                            )}
                          </div>
                          <div className="flex gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => startEditMember(fm)}
                            >
                              <Pencil aria-hidden="true" />
                              <span className="sr-only">Edit {fm.first_name}</span>
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => setRemovingMember(fm)}
                            >
                              <Trash2 className="text-destructive" aria-hidden="true" />
                              <span className="sr-only">Remove {fm.first_name}</span>
                            </Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}

                  {familyMembers.length === 0 && !showMemberForm && (
                    <p className="text-base text-muted-foreground mb-3">
                      No one is listed without an account yet.
                    </p>
                  )}

                  {showMemberForm && (
                    <div className="border rounded-md p-3 space-y-3 bg-muted/20">
                      <div className="flex items-center justify-between">
                        <p className="text-base font-medium">
                          {editingMember ? `Edit ${editingMember.first_name}` : "Add someone without an account"}
                        </p>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={closeMemberForm}
                        >
                          <X aria-hidden="true" />
                          <span className="sr-only">Cancel</span>
                        </Button>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1">
                          <Label htmlFor="fm_first">
                            First name
                          </Label>
                          <Input
                            id="fm_first"
                            value={memberForm.first_name}
                            onChange={(e) =>
                              setMemberForm({ ...memberForm, first_name: e.target.value })
                            }
                            {...invalidFieldProps("fm_first", memberNameError)}
                          />
                          <FieldError fieldId="fm_first" message={memberNameError} />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor="fm_last">
                            Last name
                          </Label>
                          <Input
                            id="fm_last"
                            value={memberForm.last_name}
                            onChange={(e) =>
                              setMemberForm({ ...memberForm, last_name: e.target.value })
                            }
                          />
                        </div>
                      </div>

                      <div className="space-y-1">
                        <Label htmlFor="fm_rel">
                          Relationship
                        </Label>
                        <Select
                          items={RELATIONSHIPS}
                          value={memberForm.relationship}
                          onValueChange={(v) =>
                            setMemberForm({
                              ...memberForm,
                              relationship: v as FamilyMemberRelationship,
                            })
                          }
                        >
                          <SelectTrigger id="fm_rel" className="w-full">
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

                      <div>
                        <Label>Birthday (optional)</Label>
                        <div className="grid grid-cols-3 gap-2 mt-1">
                          <Select
                            items={MONTHS}
                            value={memberForm.birth_month}
                            onValueChange={(v) =>
                              setMemberForm({ ...memberForm, birth_month: v ?? "" })
                            }
                          >
                            <SelectTrigger aria-label="Birthday month" className="w-full">
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
                            aria-label="Birthday day"
                            value={memberForm.birth_day}
                            onChange={(e) =>
                              setMemberForm({ ...memberForm, birth_day: e.target.value })
                            }
                          />
                          <Input
                            type="number"
                            min="1900"
                            max="2100"
                            placeholder="Year"
                            aria-label="Birthday year"
                            value={memberForm.birth_year}
                            onChange={(e) =>
                              setMemberForm({ ...memberForm, birth_year: e.target.value })
                            }
                          />
                        </div>
                      </div>

                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={closeMemberForm}
                        >
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          disabled={savingMember}
                          onClick={handleSaveMember}
                        >
                          {savingMember ? "Saving…" : editingMember ? "Save" : "Add"}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          <DialogFooter className="flex sm:justify-between">
            {editing && (
              <Button
                variant="destructive"
                disabled={membersFamilyId !== editing.id}
                onClick={() =>
                  setDeletingFamily(families.find((f) => f.id === editing.id) ?? null)
                }
              >
                <Trash2 aria-hidden="true" />
                Delete household
              </Button>
            )}
            <div className="flex gap-2 sm:ml-auto">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? "Saving…" : editing ? "Save changes" : "Add household"}
              </Button>
            </div>
          </DialogFooter>

          <ConfirmDialog
            open={deletingFamily !== null}
            onOpenChange={(open) => !open && setDeletingFamily(null)}
            title={`Delete ${deletingFamily?.family_name ?? ""}?`}
            description={deleteHouseholdConsequence(
              deletingFamily?.members.length ?? 0,
              familyMembers.length,
            )}
            confirmLabel="Delete household"
            pendingLabel="Deleting…"
            onConfirm={async () => {
              if (deletingFamily) await handleDelete(deletingFamily);
            }}
          />
          <ConfirmDialog
            open={removingMember !== null}
            onOpenChange={(open) => !open && setRemovingMember(null)}
            title={`Remove ${removingMember?.first_name ?? ""} from this household?`}
            description="They won't be listed with this household in the directory anymore."
            confirmLabel="Remove from household"
            pendingLabel="Removing…"
            onConfirm={async () => {
              if (removingMember) await handleDeleteMember(removingMember);
            }}
          />
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}

function deleteHouseholdConsequence(memberCount: number, withoutAccountCount: number): string {
  const parts: string[] = [];
  if (memberCount > 0) {
    parts.push(
      memberCount === 1
        ? "Its 1 member is left without a household."
        : `Its ${memberCount} members are left without a household.`,
    );
  }
  if (withoutAccountCount > 0) {
    parts.push(
      withoutAccountCount === 1
        ? "The 1 person listed without an account is deleted."
        : `The ${withoutAccountCount} people listed without an account are deleted.`,
    );
  }
  parts.push("This can't be undone.");
  return parts.join(" ");
}
