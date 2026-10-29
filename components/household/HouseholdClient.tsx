"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { HouseholdMemberEditClient } from "@/components/household/HouseholdMemberEditClient";
import { FamilyMemberForm } from "@/components/household/FamilyMemberForm";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Pencil, Plus, Trash2, User, UserPlus } from "lucide-react";
import {
  formatPhone,
  formatPhoneAsYouType,
  titleCaseName,
  titleCaseStreet,
  titleCaseCity,
} from "@/lib/sanitize";
import { displayName, initials } from "@/lib/names";
import { canEditSpouseProfiles as computeCanEditSpouseProfiles, type HouseholdSummary } from "@/lib/household";
import type { Profile, FamilyUnit, FamilyMember, FamilyMemberRelationship } from "@/lib/types";

const LINK_RELATIONSHIPS: { value: FamilyMemberRelationship; label: string }[] = [
  { value: "spouse", label: "Spouse" },
  { value: "primary", label: "Primary" },
  { value: "child", label: "Child (adult)" },
  { value: "parent", label: "Parent" },
  { value: "sibling", label: "Sibling" },
  { value: "other", label: "Other" },
];

interface HouseholdInfo {
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

interface SearchResult {
  id: string;
  first_name: string;
  last_name: string | null;
  preferred_name: string | null;
  avatar_url: string | null;
  email: string | null;
}

interface HouseholdClientProps {
  currentProfile: Profile;
  family: FamilyUnit;
  initialFamilyMembers: FamilyMember[];
  householdProfiles: (Profile | HouseholdSummary)[];
  /** Called when the user clicks "Edit" on their own row — the parent switches to the Me tab */
  onEditSelf: () => void;
}

function fromFamily(f: FamilyUnit): HouseholdInfo {
  return {
    family_name: f.family_name,
    address_line1: f.address_line1 ?? "",
    address_line2: f.address_line2 ?? "",
    city: f.city ?? "",
    state: f.state ?? "",
    postal_code: f.postal_code ?? "",
    phone_home: formatPhone(f.phone_home) ?? "",
    anniversary: f.anniversary ?? "",
    hide_address: f.hide_address,
    hide_phone_home: f.hide_phone_home,
  };
}

function MemberRow({
  profile,
  isYou,
  action,
}: {
  profile: Pick<Profile, "avatar_url" | "relationship" | "first_name" | "last_name" | "preferred_name">;
  isYou?: boolean;
  action: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <Avatar className="h-12 w-12">
          {profile.avatar_url && (
            <AvatarImage src={profile.avatar_url} alt={displayName(profile)} />
          )}
          <AvatarFallback className="bg-brand-primary text-white text-sm">
            {initials(profile)}
          </AvatarFallback>
        </Avatar>
        <div>
          <span className="text-base font-medium">{displayName(profile)}</span>
          <Badge variant="outline" className="ml-2 text-base capitalize">
            {profile.relationship}
          </Badge>
          {isYou && (
            <Badge variant="secondary" className="ml-1 text-base">
              You
            </Badge>
          )}
        </div>
      </div>
      {action}
    </div>
  );
}

export function HouseholdClient({
  currentProfile,
  family,
  initialFamilyMembers,
  householdProfiles,
  onEditSelf,
}: HouseholdClientProps) {
  const router = useRouter();
  const [info, setInfo] = useState<HouseholdInfo>(fromFamily(family));
  const [savingInfo, setSavingInfo] = useState(false);

  // "Add member" dialog
  const [addDialogOpen, setAddDialogOpen] = useState(false);

  // Edit sheets for another enrolled member / a family member without an account
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [fmSheetState, setFmSheetState] = useState<
    { mode: "new" } | { mode: "edit"; member: FamilyMember } | null
  >(null);

  // "Link existing account" search within the dialog
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [linkRelationship, setLinkRelationship] = useState<FamilyMemberRelationship>("spouse");
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canEditSpouseProfiles = computeCanEditSpouseProfiles(currentProfile);

  // ---- Household info ----
  async function handleSaveInfo(e: React.FormEvent) {
    e.preventDefault();
    setSavingInfo(true);

    const res = await fetch("/api/household", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        family_name: info.family_name,
        address_line1: info.address_line1,
        address_line2: info.address_line2,
        city: info.city,
        state: info.state,
        postal_code: info.postal_code,
        phone_home: info.phone_home,
        anniversary: info.anniversary || null,
        hide_address: info.hide_address,
        hide_phone_home: info.hide_phone_home,
      }),
    });

    setSavingInfo(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? "Failed to save household info.");
      return;
    }

    toast.success("Household info updated.");
    router.refresh();
  }

  // ---- Non-auth family member delete ----
  async function handleDeleteMember(fm: FamilyMember) {
    if (!confirm(`Remove ${fm.first_name} from this household?`)) return;

    const res = await fetch(`/api/household/members/${fm.id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Failed to remove family member.");
      return;
    }
    toast.success("Family member removed.");
    router.refresh();
  }

  // ---- Link existing account ----
  useEffect(() => {
    if (searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }

    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const res = await fetch(
          `/api/household/search-members?q=${encodeURIComponent(searchQuery)}`,
        );
        if (res.ok) {
          const body = await res.json();
          setSearchResults(body.data ?? []);
        }
      } finally {
        setSearchLoading(false);
      }
    }, 300);

    return () => {
      if (searchTimeout.current) clearTimeout(searchTimeout.current);
    };
  }, [searchQuery]);

  async function handleLinkMember(profileId: string) {
    setLinkingId(profileId);

    const res = await fetch("/api/household/link-member", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile_id: profileId, relationship: linkRelationship }),
    });

    setLinkingId(null);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? "Failed to add member to household.");
      return;
    }

    toast.success("Member added to your household.");
    setAddDialogOpen(false);
    setSearchQuery("");
    setSearchResults([]);
    setLinkRelationship("spouse");
    router.refresh();
  }

  return (
    <div className="space-y-8">
      {/* ---- Household Info ---- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Household Info</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSaveInfo} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="family_name" className="text-base">
                Family name <span className="text-destructive" aria-hidden>*</span>
              </Label>
              <Input
                id="family_name"
                value={info.family_name}
                onChange={(e) => setInfo({ ...info, family_name: e.target.value })}
                onBlur={(e) =>
                  setInfo({ ...info, family_name: titleCaseName(e.target.value) || "" })
                }
                required
                className="text-base py-5"
              />
            </div>

            <Separator />

            <div className="space-y-2">
              <Label htmlFor="address_line1" className="text-base">Street address</Label>
              <Input
                id="address_line1"
                value={info.address_line1}
                onChange={(e) => setInfo({ ...info, address_line1: e.target.value })}
                onBlur={(e) =>
                  setInfo({ ...info, address_line1: titleCaseStreet(e.target.value) || "" })
                }
                placeholder="123 Main St"
                className="text-base py-5"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="address_line2" className="text-base">
                Apt / unit{" "}
                <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Input
                id="address_line2"
                value={info.address_line2}
                onChange={(e) => setInfo({ ...info, address_line2: e.target.value })}
                onBlur={(e) =>
                  setInfo({ ...info, address_line2: titleCaseStreet(e.target.value) || "" })
                }
                placeholder="Apt 4B"
                className="text-base py-5"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-6 gap-3">
              <div className="sm:col-span-3 space-y-2">
                <Label htmlFor="city" className="text-base">City</Label>
                <Input
                  id="city"
                  value={info.city}
                  onChange={(e) => setInfo({ ...info, city: e.target.value })}
                  onBlur={(e) =>
                    setInfo({ ...info, city: titleCaseCity(e.target.value) || "" })
                  }
                  className="text-base py-5"
                />
              </div>
              <div className="sm:col-span-1 space-y-2">
                <Label htmlFor="state" className="text-base">State</Label>
                <Input
                  id="state"
                  value={info.state}
                  onChange={(e) => setInfo({ ...info, state: e.target.value.toUpperCase() })}
                  maxLength={2}
                  placeholder="TX"
                  className="text-base py-5 uppercase"
                />
              </div>
              <div className="sm:col-span-2 space-y-2">
                <Label htmlFor="postal_code" className="text-base">ZIP</Label>
                <Input
                  id="postal_code"
                  value={info.postal_code}
                  onChange={(e) => setInfo({ ...info, postal_code: e.target.value })}
                  placeholder="12345"
                  className="text-base py-5"
                />
              </div>
            </div>

            <Separator />

            <div className="space-y-2">
              <Label htmlFor="phone_home" className="text-base">
                Home phone{" "}
                <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Input
                id="phone_home"
                type="tel"
                inputMode="tel"
                value={info.phone_home}
                onChange={(e) =>
                  setInfo({ ...info, phone_home: formatPhoneAsYouType(e.target.value) })
                }
                placeholder="(555) 123-4567"
                className="text-base py-5"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="anniversary" className="text-base">
                Anniversary{" "}
                <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Input
                id="anniversary"
                type="date"
                value={info.anniversary}
                onChange={(e) => setInfo({ ...info, anniversary: e.target.value })}
                className="text-base py-5"
              />
            </div>

            <Separator />

            <div className="space-y-3">
              <p className="text-sm font-semibold">Privacy</p>
              <div className="flex items-center justify-between">
                <Label htmlFor="hide_address" className="text-base cursor-pointer">
                  Hide address from directory
                </Label>
                <Switch
                  id="hide_address"
                  checked={info.hide_address}
                  onCheckedChange={(v) => setInfo({ ...info, hide_address: v })}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="hide_phone_home" className="text-base cursor-pointer">
                  Hide home phone from directory
                </Label>
                <Switch
                  id="hide_phone_home"
                  checked={info.hide_phone_home}
                  onCheckedChange={(v) => setInfo({ ...info, hide_phone_home: v })}
                />
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                type="submit"
                disabled={savingInfo}
              >
                {savingInfo ? "Saving..." : "Save Household Info"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* ---- Enrolled Members ---- */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-xl">Members with Accounts</CardTitle>
            {canEditSpouseProfiles && (
              <Button variant="outline" size="sm" onClick={() => setAddDialogOpen(true)}>
                <UserPlus className="mr-1 h-4 w-4" />
                Link member
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Current user */}
          <MemberRow
            profile={currentProfile}
            isYou
            action={
              <Button variant="outline" size="sm" onClick={onEditSelf}>
                <Pencil className="mr-1 h-4 w-4" />
                Edit
              </Button>
            }
          />

          {householdProfiles.map((p) => (
            <MemberRow
              key={p.id}
              profile={p}
              action={
                canEditSpouseProfiles ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEditingMemberId(p.id)}
                  >
                    <Pencil className="mr-1 h-4 w-4" />
                    Edit profile
                  </Button>
                ) : (
                  <span className="text-base text-muted-foreground">Contact admin to edit</span>
                )
              }
            />
          ))}

          {householdProfiles.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No other enrolled members in this household yet.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ---- Non-auth Family Members ---- */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-xl">Family Members Without Accounts</CardTitle>
            {canEditSpouseProfiles && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setFmSheetState({ mode: "new" })}
              >
                <Plus className="mr-1 h-4 w-4" />
                Add member
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Children, parents, and others who don&apos;t have their own account. If someone
            already has an account in the app, use{" "}
            <button
              type="button"
              onClick={() => setAddDialogOpen(true)}
              className="underline underline-offset-2 text-foreground hover:text-brand-primary-text"
            >
              Link member
            </button>{" "}
            instead.
          </p>

          {initialFamilyMembers.map((fm) => (
            <div
              key={fm.id}
              className="flex items-center justify-between bg-muted/40 rounded-md px-3 py-2"
            >
              <div className="flex items-center gap-3">
                <Avatar className="h-12 w-12">
                  {fm.avatar_url && (
                    <AvatarImage
                      src={fm.avatar_url}
                      alt={fm.preferred_name || fm.first_name}
                    />
                  )}
                  <AvatarFallback className="bg-muted">
                    <User className="h-4 w-4 text-muted-foreground" />
                  </AvatarFallback>
                </Avatar>
                <div>
                  <span className="text-base font-medium">
                    {fm.preferred_name || fm.first_name}
                    {fm.last_name && ` ${fm.last_name}`}
                  </span>
                  <Badge variant="outline" className="ml-2 text-base capitalize">
                    {fm.relationship}
                  </Badge>
                </div>
              </div>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setFmSheetState({ mode: "edit", member: fm })}
                >
                  <Pencil className="mr-1 h-3.5 w-3.5" />
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleDeleteMember(fm)}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                  <span className="sr-only">Remove</span>
                </Button>
              </div>
            </div>
          ))}

          {initialFamilyMembers.length === 0 && (
            <p className="text-sm text-muted-foreground">No additional family members yet.</p>
          )}
        </CardContent>
      </Card>

      {/* ---- Link existing account dialog ---- */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Link an existing account</DialogTitle>
            <DialogDescription>
              Search for a member who already has an account but hasn&apos;t been assigned to a
              household yet.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="link-relationship" className="text-sm font-medium">
                Their relationship to your household
              </Label>
              <Select
                items={LINK_RELATIONSHIPS}
                value={linkRelationship}
                onValueChange={(v) => setLinkRelationship(v as FamilyMemberRelationship)}
              >
                <SelectTrigger id="link-relationship">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LINK_RELATIONSHIPS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Input
              placeholder="Search by name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />

            {searchLoading && (
              <p className="text-sm text-muted-foreground text-center py-2">Searching...</p>
            )}

            {!searchLoading && searchResults.length === 0 && searchQuery.length >= 2 && (
              <p className="text-sm text-muted-foreground text-center py-2">
                No unassigned members found.
              </p>
            )}

            {searchResults.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between rounded-md border px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <Avatar className="h-8 w-8">
                    {r.avatar_url && <AvatarImage src={r.avatar_url} alt={r.first_name} />}
                    <AvatarFallback className="text-xs bg-brand-primary text-white">
                      {`${r.first_name.charAt(0)}${(r.last_name ?? "").charAt(0)}`.toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-sm font-medium">
                      {r.preferred_name || r.first_name} {r.last_name}
                    </p>
                    {r.email && (
                      <p className="text-xs text-muted-foreground">{r.email}</p>
                    )}
                  </div>
                </div>
                <Button
                  size="sm"
                  disabled={linkingId === r.id}
                  onClick={() => handleLinkMember(r.id)}
                >
                  {linkingId === r.id ? "Linking..." : "Add"}
                </Button>
              </div>
            ))}
          </div>

          <DialogFooter showCloseButton>
            <p className="text-xs text-muted-foreground mr-auto">
              Only shows members with no household assigned.
            </p>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- Edit another enrolled member's profile ---- */}
      <Sheet open={editingMemberId !== null} onOpenChange={(o) => !o && setEditingMemberId(null)}>
        <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader className="border-b pb-3">
            <SheetTitle>Edit member</SheetTitle>
          </SheetHeader>
          {editingMemberId && (() => {
            const editingProfile = householdProfiles.find((p) => p.id === editingMemberId);
            if (!editingProfile) return null;
            return (
              <div className="px-4 pb-6">
                <HouseholdMemberEditClient
                  key={editingMemberId}
                  // Safe: this sheet only opens via the "Edit profile" button above, which is
                  // gated behind canEditSpouseProfiles — the same condition under which
                  // householdProfiles is fetched as full Profile rows (see app/profile/page.tsx).
                  profile={editingProfile as Profile}
                  onSaved={() => {
                    setEditingMemberId(null);
                    router.refresh();
                  }}
                />
              </div>
            );
          })()}
        </SheetContent>
      </Sheet>

      {/* ---- Add / edit a family member without an account ---- */}
      <Sheet open={fmSheetState !== null} onOpenChange={(o) => !o && setFmSheetState(null)}>
        <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader className="border-b pb-3">
            <SheetTitle>
              {fmSheetState?.mode === "edit" ? "Edit family member" : "Add family member"}
            </SheetTitle>
          </SheetHeader>
          <div className="px-4 pb-6">
            <FamilyMemberForm
              key={fmSheetState?.mode === "edit" ? fmSheetState.member.id : "new"}
              member={fmSheetState?.mode === "edit" ? fmSheetState.member : null}
              family={family}
              onSaved={() => {
                setFmSheetState(null);
                router.refresh();
              }}
              onCancel={() => setFmSheetState(null)}
              onChanged={() => router.refresh()}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
