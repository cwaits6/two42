"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { toast } from "sonner";
import { failureMessage, NETWORK_ERROR } from "@/lib/errorCopy";
import { Pencil, Plus, User, UserPlus, Users } from "lucide-react";
import { EmptyState } from "@/components/states/EmptyState";
import { CheckRow } from "@/components/profile/CheckRow";
import { relLabel } from "@/components/directory/utils";
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
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar className="h-12 w-12 shrink-0">
          {profile.avatar_url && (
            <AvatarImage src={profile.avatar_url} alt={displayName(profile)} />
          )}
          <AvatarFallback className="bg-brand-primary text-base text-white">
            {initials(profile)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="text-base font-medium">{displayName(profile)}</p>
          <p className="text-base text-muted-foreground">
            {[relLabel(profile.relationship), isYou && "You"].filter(Boolean).join(" · ")}
          </p>
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

  // "Add a member" dialog
  const [addDialogOpen, setAddDialogOpen] = useState(false);

  // Edit sheets for another member with an account / someone without one
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [fmSheetState, setFmSheetState] = useState<
    { mode: "new" } | { mode: "edit"; member: FamilyMember } | null
  >(null);
  const [removingMember, setRemovingMember] = useState<FamilyMember | null>(null);

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
      toast.error(
        failureMessage("save the household", res.status, {
          400: "Couldn't save the household. Check the name, state, ZIP code and home phone, then try again.",
        }),
      );
      return;
    }

    toast.success("Household saved.");
    router.refresh();
  }

  // ---- Remove someone without an account ----
  async function handleDeleteMember(fm: FamilyMember) {
    const res = await fetch(`/api/household/members/${fm.id}`, { method: "DELETE" }).catch(
      () => null,
    );
    if (!res?.ok) {
      toast.error(res ? failureMessage(`remove ${fm.first_name}`, res.status) : NETWORK_ERROR);
      // The request may have reached the server before the connection dropped.
      if (!res) {
        setRemovingMember(null);
        router.refresh();
      }
      return;
    }
    toast.success(`Removed ${fm.first_name} from your household.`);
    setRemovingMember(null);
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
        } else {
          toast.error(failureMessage("search for members", res.status));
        }
      } catch {
        toast.error(failureMessage("search for members", "network"));
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
      toast.error(
        failureMessage("add them to your household", res.status, {
          409: "They're already in a household. Ask a church admin to move them.",
        }),
      );
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
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="text-2xl">Household details</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSaveInfo} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="family_name" className="text-base">
                Household name
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

            <div className="space-y-1">
              <p className="text-base font-semibold">Privacy</p>
              <CheckRow
                id="hide_address"
                label="Hide the address from the directory"
                checked={info.hide_address}
                onChange={(v) => setInfo({ ...info, hide_address: v })}
              />
              <CheckRow
                id="hide_phone_home"
                label="Hide the home phone from the directory"
                checked={info.hide_phone_home}
                onChange={(v) => setInfo({ ...info, hide_phone_home: v })}
              />
            </div>

            <div className="border-t pt-5">
              <Button type="submit" size="lg" disabled={savingInfo}>
                {savingInfo ? "Saving…" : "Save household"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>
              <h2 className="text-2xl">Members with an account</h2>
            </CardTitle>
            {canEditSpouseProfiles && (
              <Button variant="outline" onClick={() => setAddDialogOpen(true)}>
                <UserPlus className="mr-2 h-5 w-5" aria-hidden="true" />
                Add a member
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
              <Button variant="outline" onClick={onEditSelf}>
                <Pencil className="mr-2 h-5 w-5" aria-hidden="true" />
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
                    onClick={() => setEditingMemberId(p.id)}
                    aria-label={`Edit ${displayName(p)}`}
                  >
                    <Pencil className="mr-2 h-5 w-5" aria-hidden="true" />
                    Edit
                  </Button>
                ) : (
                  <span className="text-base text-muted-foreground">
                    They edit their own profile
                  </span>
                )
              }
            />
          ))}

          {householdProfiles.length === 0 && (
            <p className="text-base text-muted-foreground">
              No one else in your household has an account yet.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>
              <h2 className="text-2xl">Others in your household</h2>
            </CardTitle>
            {canEditSpouseProfiles && (
              <Button variant="outline" onClick={() => setFmSheetState({ mode: "new" })}>
                <Plus className="mr-2 h-5 w-5" aria-hidden="true" />
                Add someone without an account
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-base text-muted-foreground">
            Children, parents and anyone else who doesn&apos;t have their own account.
            {canEditSpouseProfiles && (
              <> If they already have one, use Add a member instead.</>
            )}
          </p>

          {initialFamilyMembers.map((fm) => (
            <div
              key={fm.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/40 px-3 py-2"
            >
              <div className="flex min-w-0 items-center gap-3">
                <Avatar className="h-12 w-12 shrink-0">
                  {fm.avatar_url && (
                    <AvatarImage
                      src={fm.avatar_url}
                      alt={fm.preferred_name || fm.first_name}
                    />
                  )}
                  <AvatarFallback className="bg-muted">
                    <User className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="text-base font-medium">{displayName(fm)}</p>
                  <p className="text-base text-muted-foreground">{relLabel(fm.relationship)}</p>
                </div>
              </div>
              {canEditSpouseProfiles && (
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setFmSheetState({ mode: "edit", member: fm })}
                    aria-label={`Edit ${displayName(fm)}`}
                  >
                    <Pencil className="mr-2 h-5 w-5" aria-hidden="true" />
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setRemovingMember(fm)}
                    aria-label={`Remove ${displayName(fm)}`}
                  >
                    Remove
                  </Button>
                </div>
              )}
            </div>
          ))}

          {initialFamilyMembers.length === 0 && (
            <EmptyState icon={Users} message="No one without an account yet." />
          )}
        </CardContent>
      </Card>

      {/* ---- Link existing account dialog ---- */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add a member to your household</DialogTitle>
            <DialogDescription className="text-base">
              Search for someone who has an account and isn&apos;t in a household yet.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="link-relationship" className="text-base">
                Their relationship to your household
              </Label>
              <Select
                items={LINK_RELATIONSHIPS}
                value={linkRelationship}
                onValueChange={(v) => setLinkRelationship(v as FamilyMemberRelationship)}
              >
                <SelectTrigger id="link-relationship" className="w-full py-5 text-base">
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

            <div className="space-y-1.5">
              <Label htmlFor="link-search" className="text-base">
                Search by name
              </Label>
              <Input
                id="link-search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="py-5 text-base"
              />
            </div>

            {searchLoading && (
              <p role="status" className="py-2 text-center text-base text-muted-foreground">
                Searching…
              </p>
            )}

            {!searchLoading && searchResults.length === 0 && searchQuery.length >= 2 && (
              <p className="py-2 text-center text-base text-muted-foreground">
                No one without a household matches that name.
              </p>
            )}

            {searchResults.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar className="h-10 w-10 shrink-0">
                    {r.avatar_url && <AvatarImage src={r.avatar_url} alt={displayName(r)} />}
                    <AvatarFallback className="bg-brand-primary text-base text-white">
                      {initials(r)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="text-base font-medium">{displayName(r)}</p>
                    {r.email && (
                      <p className="truncate text-base text-muted-foreground">{r.email}</p>
                    )}
                  </div>
                </div>
                <Button
                  disabled={linkingId === r.id}
                  onClick={() => handleLinkMember(r.id)}
                  aria-label={`Add ${displayName(r)}`}
                >
                  {linkingId === r.id ? "Adding…" : "Add"}
                </Button>
              </div>
            ))}
          </div>

          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>

      {/* ---- Edit another enrolled member's profile ---- */}
      <Sheet open={editingMemberId !== null} onOpenChange={(o) => !o && setEditingMemberId(null)}>
        <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader className="border-b pb-3">
            <SheetTitle>Edit household member</SheetTitle>
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

      {/* ---- Add / edit someone without an account ---- */}
      <Sheet open={fmSheetState !== null} onOpenChange={(o) => !o && setFmSheetState(null)}>
        <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader className="border-b pb-3">
            <SheetTitle>
              {fmSheetState?.mode === "edit"
                ? `Edit ${displayName(fmSheetState.member)}`
                : "Add someone without an account"}
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

      <ConfirmDialog
        open={removingMember !== null}
        onOpenChange={(open) => !open && setRemovingMember(null)}
        title={`Remove ${removingMember?.first_name ?? ""} from your household?`}
        description="They won't be listed with your household in the directory anymore."
        confirmLabel="Remove from household"
        pendingLabel="Removing…"
        onConfirm={async () => {
          if (removingMember) await handleDeleteMember(removingMember);
        }}
      />
    </div>
  );
}
