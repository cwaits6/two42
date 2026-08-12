"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { deleteImage, uploadImage } from "@/lib/uploadImage";
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
import { toast } from "sonner";
import { Camera, Plus, Pencil, Trash2, Users, X } from "lucide-react";
import type { FamilyUnit, Profile, FamilyMember, FamilyMemberRelationship } from "@/lib/types";
import {
  titleCaseName,
  titleCaseStreet,
  titleCaseCity,
  normalizePhone,
  normalizeState,
  normalizePostalCode,
  formatPhone,
  formatPhoneAsYouType,
} from "@/lib/sanitize";
import { displayName } from "@/lib/names";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";

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

interface FamilyFormState {
  family_name: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  postal_code: string;
  phone_home: string;
  anniversary: string;
  hide_address: boolean;
  hide_phone_home: boolean;
}

const EMPTY_FORM: FamilyFormState = {
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

function fromFamily(f: FamilyUnit): FamilyFormState {
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

export default function FamiliesPage() {
  const [families, setFamilies] = useState<FamilyWithMembers[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<FamilyUnit | null>(null);
  const [form, setForm] = useState<FamilyFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // Family members state (populated when editing a family)
  const [familyMembers, setFamilyMembers] = useState<FamilyMember[]>([]);
  const [memberForm, setMemberForm] = useState<FamilyMemberFormState>(EMPTY_MEMBER_FORM);
  const [editingMember, setEditingMember] = useState<FamilyMember | null>(null);
  const [showMemberForm, setShowMemberForm] = useState(false);
  const [savingMember, setSavingMember] = useState(false);

  // Family photo state (edit mode only — the path needs the family id)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [removingPhoto, setRemovingPhoto] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const supabase = useMemo(() => createClient(), []);

  const loadFamilies = useCallback(async () => {
    setLoading(true);
    const { data: familyData, error: familyErr } = await supabase
      .from("family_units")
      .select("*")
      .order("family_name");

    if (familyErr) {
      toast.error("Failed to load families.");
      setLoading(false);
      return;
    }

    const { data: memberData } = await supabase
      .from("profiles")
      .select("id, first_name, last_name, preferred_name, family_id")
      .not("family_id", "is", null);

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
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    loadFamilies();
  }, [loadFamilies]);

  async function loadFamilyMembers(familyId: string) {
    const { data, error } = await supabase
      .from("family_members")
      .select("*")
      .eq("family_id", familyId)
      .order("relationship");

    if (error) {
      toast.error("Failed to load family members.");
      return;
    }
    setFamilyMembers((data || []) as FamilyMember[]);
  }

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setPhotoUrl(null);
    setFamilyMembers([]);
    setShowMemberForm(false);
    setEditingMember(null);
    setMemberForm(EMPTY_MEMBER_FORM);
    setDialogOpen(true);
  }

  function openEdit(family: FamilyUnit) {
    setEditing(family);
    setForm(fromFamily(family));
    setPhotoUrl(family.photo_url);
    setShowMemberForm(false);
    setEditingMember(null);
    setMemberForm(EMPTY_MEMBER_FORM);
    setDialogOpen(true);
    loadFamilyMembers(family.id);
  }

  async function handleSave() {
    const familyName = titleCaseName(form.family_name);
    if (!familyName) {
      toast.error("Family name is required.");
      return;
    }

    const stateCode = form.state ? normalizeState(form.state) : null;
    if (form.state && !stateCode) {
      toast.error("Invalid state.");
      return;
    }
    const postal = form.postal_code
      ? normalizePostalCode(form.postal_code)
      : null;
    if (form.postal_code && !postal) {
      toast.error("Invalid ZIP code.");
      return;
    }
    const phone = form.phone_home ? normalizePhone(form.phone_home) : null;
    if (form.phone_home && !phone) {
      toast.error("Invalid home phone.");
      return;
    }

    const payload = {
      family_name: familyName,
      address_line1: titleCaseStreet(form.address_line1),
      address_line2: titleCaseStreet(form.address_line2),
      city: titleCaseCity(form.city),
      state: stateCode,
      postal_code: postal,
      phone_home: phone,
      anniversary: form.anniversary || null,
      hide_address: form.hide_address,
      hide_phone_home: form.hide_phone_home,
    };

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
      toast.error("Failed to save family.");
      return;
    }

    toast.success(editing ? "Family updated." : "Family created.");
    setDialogOpen(false);
    loadFamilies();
  }

  async function handleDelete(family: FamilyWithMembers) {
    if (family.members.length > 0) {
      if (
        !confirm(
          `${family.family_name} has ${family.members.length} member(s). Deleting will unassign them. Continue?`,
        )
      ) {
        return;
      }
    } else if (!confirm(`Delete ${family.family_name}?`)) {
      return;
    }

    const { error } = await supabase
      .from("family_units")
      .delete()
      .eq("id", family.id);
    if (error) {
      toast.error("Failed to delete family.");
      return;
    }
    toast.success("Family deleted.");
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
      // Cache-bust so the new image shows immediately.
      setPhotoUrl(`${url}?t=${file.lastModified}`);
      toast.success("Family photo updated.");
      loadFamilies();
    } catch (err) {
      console.error(err);
      toast.error("Failed to upload family photo.");
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
      // `families/<id>/photo.jpg` (pre-CWA-57) is silently left behind as
      // an orphan blob: RLS filters it from the org-prefixed remove(), the
      // photo_url update below still clears the UI, and
      // scripts/rekey-storage-objects.mjs is what re-keys the estate.
      try {
        await deleteImage("family", relObjectPath("families", editing.id, "photo"));
      } catch {
        toast.error("Failed to remove family photo.");
        return;
      }
      const { error } = await supabase
        .from("family_units")
        .update({ photo_url: null })
        .eq("id", editing.id);
      if (error) {
        toast.error("Failed to remove family photo.");
        return;
      }
      setPhotoUrl(null);
      toast.success("Family photo removed.");
      loadFamilies();
    } finally {
      setRemovingPhoto(false);
    }
  }

  function startAddMember() {
    setEditingMember(null);
    setMemberForm(EMPTY_MEMBER_FORM);
    setShowMemberForm(true);
  }

  function startEditMember(fm: FamilyMember) {
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
      toast.error("First name is required.");
      return;
    }

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
      });
      if (!res.ok) {
        toast.error("Failed to update family member.");
        setSavingMember(false);
        return;
      }
      toast.success("Family member updated.");
    } else {
      const res = await fetch("/api/admin/family-members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        toast.error("Failed to add family member.");
        setSavingMember(false);
        return;
      }
      toast.success("Family member added.");
    }
    setSavingMember(false);
    setShowMemberForm(false);
    setEditingMember(null);
    setMemberForm(EMPTY_MEMBER_FORM);
    loadFamilyMembers(editing.id);
  }

  async function handleDeleteMember(fm: FamilyMember) {
    if (!confirm(`Remove ${fm.first_name} from this family?`)) return;
    const res = await fetch(`/api/admin/family-members/${fm.id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      toast.error("Failed to remove family member.");
      return;
    }
    toast.success("Family member removed.");
    if (editing) loadFamilyMembers(editing.id);
  }

  if (loading) {
    return (
      <PageContainer>
        <p className="text-xl text-muted-foreground">Loading...</p>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title="Families"
        subtitle="Group members into households with shared address and home phone."
        actions={
          <Button
            size="lg"
            onClick={openCreate}
            className="bg-brand-primary hover:bg-brand-primary/90 text-white"
          >
            <Plus className="mr-2 h-5 w-5" />
            New Family
          </Button>
        }
      />

      {families.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-base text-muted-foreground">
              No families yet. Create one to group members with a shared
              address.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {families.map((family) => (
            <Card key={family.id}>
              <CardContent className="pt-6">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  <div className="flex-1">
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
                    <div className="flex items-center gap-1 mt-2 text-sm text-muted-foreground">
                      <Users className="h-4 w-4" />
                      <span>
                        {family.members.length}{" "}
                        {family.members.length === 1 ? "member" : "members"}
                      </span>
                    </div>
                    {family.members.length > 0 && (
                      <ul className="mt-2 text-sm space-y-0.5">
                        {family.members.map((m) => (
                          <li key={m.id}>
                            <Link
                              href={`/admin/members/${m.id}`}
                              className="text-brand-primary hover:underline"
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
                      size="sm"
                      onClick={() => openEdit(family)}
                    >
                      <Pencil className="mr-1 h-4 w-4" />
                      Edit
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit family" : "New family"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="family_name">Family name</Label>
              <Input
                id="family_name"
                value={form.family_name}
                onChange={(e) =>
                  setForm({ ...form, family_name: e.target.value })
                }
                placeholder="e.g. The Smiths"
              />
            </div>

            {editing && (
              <div className="space-y-2">
                <Label>Family photo</Label>
                {photoUrl ? (
                  <div className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={photoUrl}
                      alt={`${form.family_name} family photo`}
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
                        {uploadingPhoto ? "Uploading..." : "Replace"}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={uploadingPhoto || removingPhoto}
                        onClick={handlePhotoRemove}
                      >
                        <Trash2 className="h-4 w-4" />
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
                    {uploadingPhoto ? "Uploading..." : "Upload family photo"}
                  </Button>
                )}
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoUpload}
                  className="hidden"
                />
                <p className="text-xs text-muted-foreground">
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
            <div className="grid grid-cols-6 gap-2">
              <div className="col-span-3 space-y-2">
                <Label htmlFor="f_city">City</Label>
                <Input
                  id="f_city"
                  value={form.city}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                />
              </div>
              <div className="col-span-1 space-y-2">
                <Label htmlFor="f_state">State</Label>
                <Input
                  id="f_state"
                  value={form.state}
                  onChange={(e) =>
                    setForm({ ...form, state: e.target.value.toUpperCase() })
                  }
                  maxLength={2}
                  className="uppercase"
                />
              </div>
              <div className="col-span-2 space-y-2">
                <Label htmlFor="f_zip">ZIP</Label>
                <Input
                  id="f_zip"
                  value={form.postal_code}
                  onChange={(e) =>
                    setForm({ ...form, postal_code: e.target.value })
                  }
                />
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
              />
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
              <p className="text-xs text-muted-foreground">
                Only displayed on family card if a spouse relationship exists in the household.
              </p>
            </div>

            <div className="border-t pt-4 space-y-3">
              <p className="text-sm font-semibold">Family-level privacy</p>
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

            {/* =========================================================
                FAMILY MEMBERS SECTION (only when editing an existing family)
                ========================================================= */}
            {editing && (
              <>
                <Separator />
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-semibold">Family Members</p>
                    {!showMemberForm && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={startAddMember}
                      >
                        <Plus className="mr-1 h-3 w-3" />
                        Add member
                      </Button>
                    )}
                  </div>

                  {/* Existing family members list */}
                  {familyMembers.length > 0 && (
                    <ul className="space-y-2 mb-3">
                      {familyMembers.map((fm) => (
                        <li
                          key={fm.id}
                          className="flex items-center justify-between text-sm bg-muted/40 rounded-md px-3 py-2"
                        >
                          <div>
                            <span className="font-medium">
                              {fm.first_name}
                              {fm.last_name && ` ${fm.last_name}`}
                            </span>
                            <span className="text-muted-foreground ml-2 capitalize">
                              · {fm.relationship}
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
                              <Pencil className="h-3 w-3" />
                              <span className="sr-only">Edit</span>
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => handleDeleteMember(fm)}
                            >
                              <Trash2 className="h-3 w-3 text-destructive" />
                              <span className="sr-only">Delete</span>
                            </Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}

                  {familyMembers.length === 0 && !showMemberForm && (
                    <p className="text-sm text-muted-foreground mb-3">
                      No additional family members yet.
                    </p>
                  )}

                  {/* Add / Edit family member inline form */}
                  {showMemberForm && (
                    <div className="border rounded-md p-3 space-y-3 bg-muted/20">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium">
                          {editingMember ? "Edit family member" : "Add family member"}
                        </p>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => {
                            setShowMemberForm(false);
                            setEditingMember(null);
                            setMemberForm(EMPTY_MEMBER_FORM);
                          }}
                        >
                          <X className="h-4 w-4" />
                          <span className="sr-only">Cancel</span>
                        </Button>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label htmlFor="fm_first" className="text-xs">
                            First name
                          </Label>
                          <Input
                            id="fm_first"
                            value={memberForm.first_name}
                            onChange={(e) =>
                              setMemberForm({ ...memberForm, first_name: e.target.value })
                            }
                            className="h-8 text-sm"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor="fm_last" className="text-xs">
                            Last name
                          </Label>
                          <Input
                            id="fm_last"
                            value={memberForm.last_name}
                            onChange={(e) =>
                              setMemberForm({ ...memberForm, last_name: e.target.value })
                            }
                            className="h-8 text-sm"
                          />
                        </div>
                      </div>

                      <div className="space-y-1">
                        <Label htmlFor="fm_rel" className="text-xs">
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
                          <SelectTrigger id="fm_rel" className="h-8 text-sm">
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
                        <Label className="text-xs">Birthday (optional)</Label>
                        <div className="grid grid-cols-3 gap-2 mt-1">
                          <Select
                            items={MONTHS}
                            value={memberForm.birth_month}
                            onValueChange={(v) =>
                              setMemberForm({ ...memberForm, birth_month: v ?? "" })
                            }
                          >
                            <SelectTrigger className="h-8 text-sm">
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
                            value={memberForm.birth_day}
                            onChange={(e) =>
                              setMemberForm({ ...memberForm, birth_day: e.target.value })
                            }
                            className="h-8 text-sm"
                          />
                          <Input
                            type="number"
                            min="1900"
                            max="2100"
                            placeholder="Year"
                            value={memberForm.birth_year}
                            onChange={(e) =>
                              setMemberForm({ ...memberForm, birth_year: e.target.value })
                            }
                            className="h-8 text-sm"
                          />
                        </div>
                      </div>

                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setShowMemberForm(false);
                            setEditingMember(null);
                            setMemberForm(EMPTY_MEMBER_FORM);
                          }}
                        >
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          disabled={savingMember}
                          onClick={handleSaveMember}
                          className="bg-brand-primary hover:bg-brand-primary/90 text-white"
                        >
                          {savingMember ? "Saving..." : editingMember ? "Update" : "Add"}
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
                size="sm"
                onClick={() =>
                  handleDelete(
                    families.find((f) => f.id === editing.id)!,
                  )
                }
              >
                <Trash2 className="mr-1 h-4 w-4" />
                Delete
              </Button>
            )}
            <div className="flex gap-2 sm:ml-auto">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving}
                className="bg-brand-primary hover:bg-brand-primary/90 text-white"
              >
                {saving ? "Saving..." : editing ? "Save Changes" : "Create"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
