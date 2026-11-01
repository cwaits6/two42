"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { mintSignedUrls } from "@/lib/uploadImage";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { FieldError, invalidFieldProps } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CalendarSubscriptionCard } from "./CalendarSubscriptionCard";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BlockEditor } from "@/components/editor";
import { parseStoredBlocks } from "@/components/editor/normalizeBlocks";
import { EmptyState } from "@/components/states/EmptyState";
import { ErrorState } from "@/components/states/ErrorState";
import { LoadingState } from "@/components/states/LoadingState";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Pencil, Plus, Search, Users, X } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { failureMessage } from "@/lib/errorCopy";
import { displayName, initials } from "@/lib/names";
import { groupPath } from "@/lib/groups/active";
import type { GroupSettingsValues } from "@/lib/groups/settings";
import type { ClassTeacherWithProfile } from "@/lib/types";
import { STORED_MEMBER_ROLES } from "@/lib/roles";
import {
  aboutChanges,
  colorError,
  hasChanges,
  videoCallUrlError,
  type AboutFields,
  type LeaderEntry,
} from "./aboutChanges";
import { useLeaveGuard } from "./useLeaveGuard";

type Person = NonNullable<ClassTeacherWithProfile["profiles"]>;

interface AboutEditorProps {
  groupId: string;
  groupName: string;
  initialBody: string;
  initialTeachers: ClassTeacherWithProfile[];
  initialColor: string;
  initialSettings: GroupSettingsValues;
}

type FieldErrors = { color?: string; videoCallUrl?: string };

export function AboutEditor({
  groupId,
  groupName,
  initialBody,
  initialTeachers,
  initialColor,
  initialSettings,
}: AboutEditorProps) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();

  const [saved, setSaved] = useState<AboutFields>(() => ({
    color: initialColor,
    videoCallUrl: initialSettings.weekly_zoom_url ?? "",
    videoCallTime: initialSettings.zoom_meeting_time ?? "",
    leaders: initialTeachers.map(({ profile_id, title, bio }) => ({ profile_id, title, bio })),
  }));
  const [draft, setDraft] = useState(saved);
  // Null until the editor is edited: an untouched editor must not overwrite the stored body.
  const [summary, setSummary] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);

  const changes = aboutChanges(saved, draft, summary);
  const dirty = hasChanges(changes);
  const leaveGuard = useLeaveGuard(dirty);

  const setField = <K extends keyof AboutFields>(key: K, value: AboutFields[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    const found: FieldErrors = {
      color: colorError(draft.color),
      videoCallUrl: videoCallUrlError(draft.videoCallUrl),
    };
    setErrors(found);
    if (found.color) {
      document.getElementById("group-color")?.focus();
      return;
    }
    if (found.videoCallUrl) {
      document.getElementById("weekly-zoom-url")?.focus();
      return;
    }

    setSaving(true);
    let failure: number | "network" | null;
    try {
      const res = await fetch(groupPath(groupId, "/settings/about/save"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changes),
      });
      failure = res.ok ? null : res.status;
    } catch {
      failure = "network";
    }
    setSaving(false);
    if (failure !== null) {
      toast.error(
        failureMessage("save the About page", failure, {
          409: "Someone on the Leadership list isn't in this group. Remove them, then save again.",
        }),
      );
      return;
    }
    const normalized = {
      ...draft,
      videoCallUrl: draft.videoCallUrl.trim(),
      videoCallTime: draft.videoCallTime.trim(),
    };
    setSaved(normalized);
    setDraft(normalized);
    setSummary(null);
    toast.success("About page saved.");
    router.refresh();
  };

  // --- Leadership ---
  const [people, setPeople] = useState<Record<string, Person | null>>(() =>
    Object.fromEntries(initialTeachers.map((t) => [t.profile_id, t.profiles])),
  );
  const [addOpen, setAddOpen] = useState(false);
  const [candidates, setCandidates] = useState<Person[] | null>(null);
  const [candidatesFailed, setCandidatesFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<LeaderEntry | null>(null);
  const [removing, setRemoving] = useState<LeaderEntry | null>(null);

  const loadCandidates = async () => {
    setCandidatesFailed(false);
    const { data, error } = await supabase
      .from("group_members")
      .select("profiles!inner(id, first_name, last_name, preferred_name, avatar_url, role)")
      .eq("group_id", groupId)
      .in("profiles.role", STORED_MEMBER_ROLES);
    if (error) {
      console.error("Failed to load the group's members:", error);
      setCandidatesFailed(true);
      return;
    }
    // The to-one embed reads as an array in the inferred type.
    const rows = ((data ?? []) as unknown as { profiles: Person }[])
      .map((row) => row.profiles)
      .sort(
        (a, b) =>
          (a.last_name ?? "").localeCompare(b.last_name ?? "") ||
          (a.first_name ?? "").localeCompare(b.first_name ?? ""),
      );
    // Private buckets: exchange stored avatar URLs for signed URLs
    // before they reach the candidate-list AvatarImage renders.
    const signed = await mintSignedUrls(rows.map((r) => r.avatar_url));
    setCandidates(rows.map((r, i) => ({ ...r, avatar_url: signed[i] })));
  };

  const openAdd = () => {
    setQuery("");
    setAddOpen(true);
    if (!candidates) void loadCandidates();
  };

  const visibleCandidates = useMemo(() => {
    if (!candidates) return [];
    const taken = new Set(draft.leaders.map((l) => l.profile_id));
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
  }, [candidates, draft.leaders, query]);

  const handleAdd = (member: Person) => {
    // Someone removed earlier in this edit returns with what is saved for them.
    const entry = saved.leaders.find((l) => l.profile_id === member.id) ?? {
      profile_id: member.id,
      title: "",
      bio: "",
    };
    setPeople((prev) => ({ ...prev, [member.id]: prev[member.id] ?? member }));
    setField("leaders", [...draft.leaders, entry]);
    setAddOpen(false);
    // Go straight to the title form so the new entry doesn't sit empty
    setEditing(entry);
  };

  const handleMove = (index: number, direction: -1 | 1) => {
    const next = [...draft.leaders];
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    setField("leaders", next);
  };

  const handleEditDone = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editing) return;
    const formData = new FormData(e.currentTarget);
    const title = (formData.get("title") as string).trim();
    const bio = (formData.get("bio") as string).trim();
    setField(
      "leaders",
      draft.leaders.map((l) => (l.profile_id === editing.profile_id ? { ...l, title, bio } : l)),
    );
    setEditing(null);
  };

  const nameOf = (entry: LeaderEntry) => displayName(people[entry.profile_id] ?? null);

  return (
    <PageContainer size="default" className="space-y-8">
      <PageHeader
        title="About"
        subtitle={`Changes here apply to ${groupName} only.`}
        backHref={groupPath(groupId, "/settings")}
        backLabel="Back to Group settings"
        actions={
          <Button variant="outline" nativeButton={false} render={<Link href={groupPath(groupId, "/about")} />}>
            View page
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-xl font-bold text-foreground">Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg overflow-hidden border border-border">
            <BlockEditor
              initialContent={parseStoredBlocks(initialBody) ?? undefined}
              onChange={(blocks) => setSummary(JSON.stringify(blocks))}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-xl font-bold text-foreground">Group color</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-base text-muted-foreground">
            Used for the group in the switcher, on Home and on calendar events.
          </p>
          <div className="space-y-2">
            <Label htmlFor="group-color" className="text-base">Color</Label>
            <input
              id="group-color"
              type="color"
              value={draft.color}
              onChange={(e) => setField("color", e.target.value)}
              className="block h-12 w-20 cursor-pointer rounded-md border border-input p-1"
              {...invalidFieldProps("group-color", errors.color)}
            />
            <FieldError fieldId="group-color" message={errors.color} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-xl font-bold text-foreground">Weekly calls</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="weekly-zoom-url" className="text-base">Video call link</Label>
              <Input
                id="weekly-zoom-url"
                type="url"
                placeholder="https://…"
                value={draft.videoCallUrl}
                onChange={(e) => setField("videoCallUrl", e.target.value)}
                className="text-base"
                {...invalidFieldProps("weekly-zoom-url", errors.videoCallUrl)}
              />
              <FieldError fieldId="weekly-zoom-url" message={errors.videoCallUrl} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="zoom-meeting-time" className="text-base">Video call time</Label>
              <Input
                id="zoom-meeting-time"
                placeholder="Thursdays at 7pm"
                value={draft.videoCallTime}
                onChange={(e) => setField("videoCallTime", e.target.value)}
                className="text-base"
              />
            </div>
          </div>
          <p className="text-base text-muted-foreground">
            The prayer call is set up on the{" "}
            <Link
              href={groupPath(groupId, "/prayer")}
              className="font-semibold text-brand-primary-text underline underline-offset-4 hover:text-foreground"
            >
              Prayer page
            </Link>
            .
          </p>
        </CardContent>
      </Card>

      <CalendarSubscriptionCard
        groupId={groupId}
        initial={{
          calendar_meeting_details: initialSettings.calendar_meeting_details,
          calendar_event_notes: initialSettings.calendar_event_notes,
          calendar_event_location: initialSettings.calendar_event_location,
        }}
      />

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-xl font-bold text-foreground">Leadership</CardTitle>
            {draft.leaders.length > 0 && (
              <Button variant="outline" onClick={openAdd}>
                <Plus aria-hidden="true" />
                Add member
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-base text-muted-foreground">
            Titles are shown on the About page. They change nothing about what a member can do.
          </p>
          {draft.leaders.length === 0 ? (
            <EmptyState
              icon={Users}
              message="No one listed yet."
              action={
                <Button variant="outline" onClick={openAdd}>
                  <Plus aria-hidden="true" />
                  Add member
                </Button>
              }
            />
          ) : (
            <ul className="divide-y divide-border">
              {draft.leaders.map((leader, index) => {
                const person = people[leader.profile_id] ?? null;
                const name = displayName(person);
                return (
                  <li
                    key={leader.profile_id}
                    className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-3"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <Avatar className="h-12 w-12 shrink-0">
                        {person?.avatar_url && <AvatarImage src={person.avatar_url} alt={name} />}
                        <AvatarFallback className="bg-brand-primary text-white text-base">
                          {initials(person)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="truncate text-base font-semibold text-foreground">{name}</p>
                        <p className="truncate text-base text-muted-foreground">
                          {[leader.title, leader.bio || "No bio yet."].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1 self-end sm:self-auto">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        disabled={index === 0}
                        onClick={() => handleMove(index, -1)}
                        aria-label={`Move ${name} up`}
                      >
                        <ArrowUp aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        disabled={index === draft.leaders.length - 1}
                        onClick={() => handleMove(index, 1)}
                        aria-label={`Move ${name} down`}
                      >
                        <ArrowDown aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setEditing(leader)}
                        aria-label={`Edit ${name}`}
                      >
                        <Pencil aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setRemoving(leader)}
                        aria-label={`Remove ${name}`}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <X aria-hidden="true" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="space-y-3">
        <p aria-live="polite" className="min-h-6 text-base text-muted-foreground">
          {dirty ? "You have unsaved changes." : ""}
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button size="lg" onClick={handleSave} disabled={saving || !dirty}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
          <Button
            size="lg"
            variant="outline"
            nativeButton={false}
            render={<Link href={groupPath(groupId, "/settings")} />}
          >
            Cancel
          </Button>
        </div>
      </div>

      <Dialog open={addOpen} onOpenChange={(o) => !o && setAddOpen(false)}>
        <DialogContent className="max-w-md max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Add member</DialogTitle>
          </DialogHeader>
          <div className="relative shrink-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" aria-hidden="true" />
            <Input
              type="search"
              aria-label="Search members"
              placeholder="Search members…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-10 text-base"
            />
          </div>
          <div className="overflow-y-auto flex-1 -mx-1 px-1">
            {candidatesFailed ? (
              <ErrorState thing="members" onRetry={loadCandidates} />
            ) : !candidates ? (
              <LoadingState thing="members" />
            ) : visibleCandidates.length === 0 ? (
              <p className="text-base text-muted-foreground py-6 text-center">
                {query.trim()
                  ? "No one matches your search."
                  : "Everyone in this group is already listed."}
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {visibleCandidates.map((member) => (
                  <li key={member.id} className="flex items-center gap-3 py-2.5">
                    <Avatar className="h-10 w-10 shrink-0">
                      {member.avatar_url && (
                        <AvatarImage src={member.avatar_url} alt={displayName(member)} />
                      )}
                      <AvatarFallback className="bg-brand-primary text-white text-base">
                        {initials(member)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="flex-1 min-w-0 text-base font-medium truncate">
                      {displayName(member)}
                    </span>
                    <Button
                      variant="outline"
                      onClick={() => handleAdd(member)}
                      aria-label={`Add ${displayName(member)}`}
                    >
                      Add
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? nameOf(editing) : ""}</DialogTitle>
          </DialogHeader>
          {editing && (
            <form onSubmit={handleEditDone} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="teacher-title" className="text-base">Title (optional)</Label>
                <Input
                  id="teacher-title"
                  name="title"
                  defaultValue={editing.title}
                  placeholder="Co-leader, Coordinator"
                  className="text-base"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="teacher-bio" className="text-base">Bio (optional)</Label>
                <Textarea
                  id="teacher-bio"
                  name="bio"
                  rows={6}
                  defaultValue={editing.bio}
                  placeholder="A few sentences about this member."
                  className="text-base"
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
                <Button type="submit">Done</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={removing === null ? "" : `Remove ${nameOf(removing)} from the About page?`}
        description="They stay in the group. Only their entry on this page goes, once you save."
        confirmLabel="Remove from page"
        onConfirm={async () => {
          if (!removing) return;
          setField("leaders", draft.leaders.filter((l) => l.profile_id !== removing.profile_id));
          setRemoving(null);
        }}
      />
      <ConfirmDialog
        open={leaveGuard.asking}
        onOpenChange={(open) => !open && leaveGuard.stay()}
        title="Leave without saving?"
        description="Your changes to this page will be lost."
        confirmLabel="Leave without saving"
        cancelLabel="Keep editing"
        onConfirm={async () => leaveGuard.leave()}
      />
    </PageContainer>
  );
}
