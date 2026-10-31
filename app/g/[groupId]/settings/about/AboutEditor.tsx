"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { mintSignedUrl, mintSignedUrls } from "@/lib/uploadImage";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CalendarSubscriptionCard } from "./CalendarSubscriptionCard";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BlockEditor } from "@/components/editor";
import { parseStoredBlocks } from "@/components/editor/normalizeBlocks";
import type { CuratedBlock } from "@/components/editor/schema";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Pencil, Plus, Search, X } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { displayName, initials } from "@/lib/names";
import { groupPath } from "@/lib/groups/active";
import { ensureGroupCalendar } from "@/lib/groups/calendar";
import { validateGroupColor, type GroupSettingsValues } from "@/lib/groups/settings";
import type { ClassTeacherWithProfile } from "@/lib/types";
import { STORED_MEMBER_ROLES } from "@/lib/roles";

type MemberOption = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  avatar_url: string | null;
};

interface AboutEditorProps {
  groupId: string;
  groupName: string;
  /** The caller's own org, resolved server-side; stamps the calendar insert when one is needed. */
  orgId: string;
  initialBody: string;
  initialTeachers: ClassTeacherWithProfile[];
  /** The group's calendar, or null when the group has none yet. */
  calendarId: string | null;
  initialColor: string;
  initialSettings: GroupSettingsValues;
}

const TEACHER_SELECT =
  "*, profiles(id, first_name, last_name, preferred_name, avatar_url)";

function isHttpsOrEmpty(value: string): boolean {
  return value === "" || /^https:\/\//i.test(value);
}

export function AboutEditor({
  groupId,
  groupName,
  orgId,
  initialBody,
  initialTeachers,
  calendarId,
  initialColor,
  initialSettings,
}: AboutEditorProps) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();

  // --- Summary ---
  const blocksRef = useRef<CuratedBlock[]>([]);
  const isDirtyRef = useRef(false);
  const [savingSummary, setSavingSummary] = useState(false);

  const handleSaveSummary = async () => {
    setSavingSummary(true);
    // If the editor was never touched, preserve the existing body instead of
    // overwriting it with []
    const body = isDirtyRef.current
      ? JSON.stringify(blocksRef.current)
      : initialBody || "[]";

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { data, error } = await supabase
      .from("about_page")
      .upsert({
        group_id: groupId,
        body,
        updated_by: user?.id,
        updated_at: new Date().toISOString(),
      })
      .select("group_id");

    setSavingSummary(false);
    if (error || !data?.length) {
      toast.error("Failed to save the summary.");
      return;
    }
    toast.success("Summary saved.");
    isDirtyRef.current = false;
  };

  // --- Group color ---
  const [color, setColor] = useState(initialColor);
  const [savingColor, setSavingColor] = useState(false);

  const handleSaveColor = async () => {
    const check = validateGroupColor(color);
    if (!check.ok) {
      toast.error(check.reason);
      return;
    }
    setSavingColor(true);
    const targetCalendar =
      calendarId ?? (await ensureGroupCalendar(supabase, orgId, groupId, groupName));
    if (!targetCalendar) {
      setSavingColor(false);
      toast.error("Failed to save the group color.");
      return;
    }
    const { data, error } = await supabase
      .from("event_calendars")
      .update({ color: check.color })
      .eq("id", targetCalendar)
      .eq("group_id", groupId)
      .select("id");
    setSavingColor(false);
    if (error || !data?.length) {
      toast.error("Failed to save the group color.");
      return;
    }
    toast.success("Group color saved.");
    router.refresh();
  };

  // --- Weekly calls ---
  const [calls, setCalls] = useState({
    weekly_zoom_url: initialSettings.weekly_zoom_url ?? "",
    zoom_meeting_time: initialSettings.zoom_meeting_time ?? "",
    weekly_prayer_call_url: initialSettings.weekly_prayer_call_url ?? "",
    weekly_prayer_call_time: initialSettings.weekly_prayer_call_time ?? "",
  });
  const [savingCalls, setSavingCalls] = useState(false);
  const setCall = (key: keyof typeof calls, value: string) =>
    setCalls((prev) => ({ ...prev, [key]: value }));

  const handleSaveCalls = async () => {
    const zoomUrl = calls.weekly_zoom_url.trim();
    const prayerUrl = calls.weekly_prayer_call_url.trim();
    if (!isHttpsOrEmpty(zoomUrl) || !isHttpsOrEmpty(prayerUrl)) {
      toast.error("Call links must start with https://");
      return;
    }
    setSavingCalls(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from("group_settings")
      .upsert({
        group_id: groupId,
        weekly_zoom_url: zoomUrl || null,
        zoom_meeting_time: calls.zoom_meeting_time.trim() || null,
        weekly_prayer_call_url: prayerUrl || null,
        weekly_prayer_call_time: calls.weekly_prayer_call_time.trim() || null,
        updated_by: user?.id,
        updated_at: new Date().toISOString(),
      })
      .select("group_id");
    setSavingCalls(false);
    if (error || !data?.length) {
      toast.error("Failed to save the weekly calls.");
      return;
    }
    toast.success("Weekly calls saved.");
  };

  // --- Leadership ---
  const [teachers, setTeachers] = useState(initialTeachers);
  const [addOpen, setAddOpen] = useState(false);
  const [candidates, setCandidates] = useState<MemberOption[] | null>(null);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<ClassTeacherWithProfile | null>(null);
  const [removing, setRemoving] = useState<ClassTeacherWithProfile | null>(null);
  const [busy, setBusy] = useState(false);

  const openAdd = async () => {
    setQuery("");
    setAddOpen(true);
    if (candidates) return;
    // Any member of the org may be listed; leadership here is a title, not a permission.
    const { data, error } = await supabase
      .from("profiles")
      .select("id, first_name, last_name, preferred_name, avatar_url")
      .in("role", STORED_MEMBER_ROLES)
      .order("last_name")
      .order("first_name");
    if (error) {
      toast.error("Failed to load members.");
      setAddOpen(false);
      return;
    }
    // Private buckets: exchange stored avatar URLs for signed URLs
    // before they reach the candidate-list AvatarImage renders.
    const rows = (data ?? []) as MemberOption[];
    const signed = await mintSignedUrls(rows.map((r) => r.avatar_url));
    setCandidates(rows.map((r, i) => ({ ...r, avatar_url: signed[i] })));
  };

  const visibleCandidates = useMemo(() => {
    if (!candidates) return [];
    const taken = new Set(teachers.map((t) => t.profile_id));
    const available = candidates.filter((c) => !taken.has(c.id));
    if (!query.trim()) return available;
    const q = query.trim().toLowerCase();
    return available.filter((c) =>
      [c.first_name, c.last_name, c.preferred_name]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [candidates, teachers, query]);

  const handleAdd = async (member: MemberOption) => {
    setBusy(true);
    const nextOrder =
      teachers.reduce((max, t) => Math.max(max, t.sort_order), -1) + 1;
    const { data, error } = await supabase
      .from("class_teachers")
      .insert({ profile_id: member.id, sort_order: nextOrder, group_id: groupId })
      .select(TEACHER_SELECT)
      .single();
    setBusy(false);
    if (error || !data) {
      toast.error("Failed to add person.");
      return;
    }
    const added = data as ClassTeacherWithProfile;
    // The insert re-selects the raw stored URL — re-sign it for display.
    // The candidate row's avatar_url is already signed, so reuse it first.
    // The DB write above already succeeded, so a signing failure here must
    // not stop the new person from appearing in the list.
    if (added.profiles) {
      let avatarUrl = member.avatar_url ?? null;
      if (!avatarUrl) {
        try {
          avatarUrl = await mintSignedUrl(added.profiles.avatar_url);
        } catch (err) {
          console.error("handleAdd: signing new leader's avatar failed", err);
        }
      }
      added.profiles = { ...added.profiles, avatar_url: avatarUrl };
    }
    setTeachers((prev) => [...prev, added]);
    setAddOpen(false);
    // Go straight to the title form so the new entry doesn't sit empty
    setEditing(added);
  };

  const handleRemove = async () => {
    if (!removing) return;
    const teacher = removing;
    const { data, error } = await supabase
      .from("class_teachers")
      .delete()
      .eq("id", teacher.id)
      .eq("group_id", groupId)
      .select("id");
    if (error || !data?.length) {
      toast.error("Failed to remove person.");
      return;
    }
    setTeachers((prev) => prev.filter((t) => t.id !== teacher.id));
    setRemoving(null);
    toast.success("Person removed.");
  };

  const handleMove = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= teachers.length) return;
    setBusy(true);
    const a = teachers[index];
    const b = teachers[target];
    // Swap sort_order values; fall back to indexes if they were equal
    const aOrder = a.sort_order === b.sort_order ? target : b.sort_order;
    const bOrder = a.sort_order === b.sort_order ? index : a.sort_order;
    const [{ error: e1 }, { error: e2 }] = await Promise.all([
      supabase.from("class_teachers").update({ sort_order: aOrder }).eq("id", a.id).eq("group_id", groupId),
      supabase.from("class_teachers").update({ sort_order: bOrder }).eq("id", b.id).eq("group_id", groupId),
    ]);
    setBusy(false);
    if (e1 || e2) {
      toast.error("Failed to reorder.");
      return;
    }
    setTeachers((prev) => {
      const next = [...prev];
      next[index] = { ...b, sort_order: bOrder };
      next[target] = { ...a, sort_order: aOrder };
      return next;
    });
  };

  const handleSaveTeacher = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editing) return;
    setBusy(true);
    const formData = new FormData(e.currentTarget);
    const title = (formData.get("title") as string).trim() || "Teacher";
    const bio = (formData.get("bio") as string).trim();
    const { data, error } = await supabase
      .from("class_teachers")
      .update({ title, bio })
      .eq("id", editing.id)
      .eq("group_id", groupId)
      .select("id");
    setBusy(false);
    if (error || !data?.length) {
      toast.error("Failed to save.");
      return;
    }
    setTeachers((prev) =>
      prev.map((t) => (t.id === editing.id ? { ...t, title, bio } : t)),
    );
    setEditing(null);
    toast.success("Saved.");
  };

  return (
    <PageContainer size="default" className="space-y-8">
      <PageHeader
        title="About"
        subtitle={`Changes here apply to ${groupName} only.`}
        actions={
          <Button variant="outline" nativeButton={false} render={<Link href={groupPath(groupId, "/about")} />}>
            View page
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-2xl text-brand-primary-text">
            Summary
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg overflow-hidden border border-border">
            <BlockEditor
              initialContent={parseStoredBlocks(initialBody) ?? undefined}
              onChange={(blocks) => {
                blocksRef.current = blocks;
                isDirtyRef.current = true;
              }}
            />
          </div>
          <Button
            onClick={handleSaveSummary}
            disabled={savingSummary}
          >
            {savingSummary ? "Saving..." : "Save summary"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-2xl text-brand-primary-text">Group color</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-base text-muted-foreground">
            Used for the group in the switcher, on Home and on calendar events.
          </p>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-2">
              <Label htmlFor="group-color" className="text-base">Color</Label>
              <div className="flex items-center gap-3">
                <input
                  id="group-color"
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="block h-12 w-20 cursor-pointer rounded-md border border-input p-1"
                />
                <Input
                  aria-label="Hex color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  maxLength={7}
                  className="w-32 font-mono text-base"
                />
              </div>
            </div>
            <Button
              onClick={handleSaveColor}
              disabled={savingColor}
            >
              {savingColor ? "Saving..." : "Save color"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-2xl text-brand-primary-text">Weekly calls</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="weekly-zoom-url" className="text-base">Video call link</Label>
              <Input
                id="weekly-zoom-url"
                type="url"
                placeholder="https://…"
                value={calls.weekly_zoom_url}
                onChange={(e) => setCall("weekly_zoom_url", e.target.value)}
                className="text-base"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="zoom-meeting-time" className="text-base">Video call time</Label>
              <Input
                id="zoom-meeting-time"
                placeholder="Thursdays at 7pm"
                value={calls.zoom_meeting_time}
                onChange={(e) => setCall("zoom_meeting_time", e.target.value)}
                className="text-base"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="weekly-prayer-call-url" className="text-base">Prayer call link</Label>
              <Input
                id="weekly-prayer-call-url"
                type="url"
                placeholder="https://…"
                value={calls.weekly_prayer_call_url}
                onChange={(e) => setCall("weekly_prayer_call_url", e.target.value)}
                className="text-base"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="weekly-prayer-call-time" className="text-base">Prayer call time</Label>
              <Input
                id="weekly-prayer-call-time"
                placeholder="Tuesdays at 7am"
                value={calls.weekly_prayer_call_time}
                onChange={(e) => setCall("weekly_prayer_call_time", e.target.value)}
                className="text-base"
              />
            </div>
          </div>
          <Button
            onClick={handleSaveCalls}
            disabled={savingCalls}
          >
            {savingCalls ? "Saving..." : "Save weekly calls"}
          </Button>
        </CardContent>
      </Card>

      <CalendarSubscriptionCard
        groupId={groupId}
        initial={{
          calendar_meeting_details: initialSettings.calendar_meeting_details,
          calendar_event_notes: initialSettings.calendar_event_notes,
        }}
      />

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-2xl text-brand-primary-text">
              Leadership
            </CardTitle>
            <Button
              size="sm"
              onClick={openAdd}
            >
              <Plus className="mr-1 h-4 w-4" />
              Add person
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-base text-muted-foreground">
            Titles are shown on the About page. They change nothing about what a person can do.
          </p>
          {teachers.length === 0 ? (
            <p className="text-muted-foreground py-4 text-center">
              No one listed yet. Use &ldquo;Add person&rdquo; to pick a member.
            </p>
          ) : (
            <div className="divide-y">
              {teachers.map((teacher, index) => (
                <div key={teacher.id} className="flex items-center gap-3 py-3">
                  <Avatar className="h-10 w-10 shrink-0">
                    {teacher.profiles?.avatar_url && (
                      <AvatarImage
                        src={teacher.profiles.avatar_url}
                        alt={displayName(teacher.profiles)}
                      />
                    )}
                    <AvatarFallback className="bg-brand-primary text-white text-sm">
                      {initials(teacher.profiles)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">
                      {displayName(teacher.profiles)}
                      <span className="ml-2 text-base font-medium uppercase tracking-wider text-muted-foreground">
                        {teacher.title}
                      </span>
                    </p>
                    <p className="text-sm text-muted-foreground truncate">
                      {teacher.bio || "No bio yet."}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={busy || index === 0}
                    onClick={() => handleMove(index, -1)}
                    aria-label={`Move ${displayName(teacher.profiles)} up`}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={busy || index === teachers.length - 1}
                    onClick={() => handleMove(index, 1)}
                    aria-label={`Move ${displayName(teacher.profiles)} down`}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={busy}
                    onClick={() => setEditing(teacher)}
                    aria-label={`Edit ${displayName(teacher.profiles)}`}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={busy}
                    onClick={() => setRemoving(teacher)}
                    aria-label={`Remove ${displayName(teacher.profiles)}`}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={addOpen} onOpenChange={(o) => !o && setAddOpen(false)}>
        <DialogContent className="max-w-md max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Add person</DialogTitle>
          </DialogHeader>
          <div className="relative shrink-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search members..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <div className="overflow-y-auto flex-1 -mx-1 px-1">
            {!candidates ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                Loading members...
              </p>
            ) : visibleCandidates.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                {query.trim()
                  ? "No one matches your search."
                  : "Everyone is already listed."}
              </p>
            ) : (
              <div className="divide-y">
                {visibleCandidates.map((member) => (
                  <div key={member.id} className="flex items-center gap-3 py-2.5">
                    <Avatar className="h-8 w-8 shrink-0">
                      {member.avatar_url && (
                        <AvatarImage
                          src={member.avatar_url}
                          alt={displayName(member)}
                        />
                      )}
                      <AvatarFallback className="bg-brand-primary text-white text-xs">
                        {initials(member)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="flex-1 min-w-0 text-sm font-medium truncate">
                      {displayName(member)}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => handleAdd(member)}
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" />
                      Add
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editing ? displayName(editing.profiles) : ""}
            </DialogTitle>
          </DialogHeader>
          {editing && (
            <form onSubmit={handleSaveTeacher} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="teacher-title">Title</Label>
                <Input
                  id="teacher-title"
                  name="title"
                  defaultValue={editing.title}
                  placeholder="Teacher, Coordinator, Host"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="teacher-bio">Bio</Label>
                <Textarea
                  id="teacher-bio"
                  name="bio"
                  rows={6}
                  defaultValue={editing.bio}
                  placeholder="A few sentences about this person."
                />
              </div>
              <div className="flex gap-3 justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditing(null)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={busy}
                >
                  {busy ? "Saving..." : "Save"}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={
          removing === null
            ? ""
            : `Remove ${displayName(removing.profiles)} from the About page?`
        }
        description="They stay in the group. Only their entry on this page goes."
        confirmLabel="Remove person"
        pendingLabel="Removing…"
        onConfirm={handleRemove}
      />
    </PageContainer>
  );
}
