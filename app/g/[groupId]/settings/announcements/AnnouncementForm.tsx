"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { groupPath } from "@/lib/groups/active";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FieldError, invalidFieldProps } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Segmented } from "@/components/ui/segmented";
import { BlockEditor } from "@/components/editor";
import { parseStoredBlocks } from "@/components/editor/normalizeBlocks";
import type { CuratedBlock } from "@/components/editor/schema";
import { zoneName } from "@/components/events/eventTimes";
import {
  PUBLISH_CHOICES,
  publishChoiceOf,
  publishFields,
  type PublishChoice,
} from "@/lib/announcements";
import { failureMessage } from "@/lib/errorCopy";
import { formatInZone, isoToLocalInput } from "@/lib/time/zone";
import type { Announcement } from "@/lib/types";

const ZONE_NOTE_ID = "scheduled_at-zone";
const CONTENT_LABEL_ID = "announcement-content-label";

const SUBMIT_LABEL: Record<PublishChoice, string> = {
  now: "Publish announcement",
  schedule: "Schedule announcement",
  draft: "Save draft",
};

type FieldErrors = { title?: string; scheduled_at?: string };

export function AnnouncementForm({
  groupId,
  groupName,
  timeZone,
  announcement,
}: {
  groupId: string;
  groupName: string;
  /** The church's zone, resolved by the server; the schedule field is its wall clock. */
  timeZone: string;
  /** The announcement being edited; absent when adding one. */
  announcement?: Announcement;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const listHref = groupPath(groupId, "/settings/announcements");
  const initialChoice = announcement ? publishChoiceOf(announcement) : "now";

  const [title, setTitle] = useState(announcement?.title ?? "");
  const [choice, setChoice] = useState<PublishChoice>(initialChoice);
  const [scheduledAt, setScheduledAt] = useState(
    initialChoice === "schedule" && announcement?.published_at
      ? isoToLocalInput(announcement.published_at, timeZone)
      : "",
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [focusTarget, setFocusTarget] = useState<{ id: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const blocksRef = useRef<CuratedBlock[] | null>(null);
  const initialBlocks = useMemo(
    () => (announcement ? parseStoredBlocks(announcement.content) ?? undefined : undefined),
    [announcement],
  );

  useEffect(() => {
    if (focusTarget) document.getElementById(focusTarget.id)?.focus();
  }, [focusTarget]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const found: FieldErrors = {};
    if (!title.trim()) found.title = "Enter a title.";
    const fields = publishFields(choice, scheduledAt, timeZone, new Date(), announcement ?? null);
    if (!fields.ok) found.scheduled_at = fields.error;
    setErrors(found);
    if (!fields.ok || found.title) {
      setFocusTarget({ id: found.title ? "title" : "scheduled_at" });
      return;
    }

    setSaving(true);
    const publication = { is_published: fields.is_published, published_at: fields.published_at };
    // An editor that was never touched keeps the stored body, which may be legacy HTML.
    const content = blocksRef.current
      ? JSON.stringify(blocksRef.current)
      : (announcement?.content ?? JSON.stringify([]));

    let failed: boolean;
    try {
      if (announcement) {
        const { data, error } = await supabase
          .from("announcements")
          .update({ title: title.trim(), content, ...publication })
          .eq("id", announcement.id)
          .eq("group_id", groupId)
          .select("id");
        failed = !!error || !data?.length;
      } else {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        const { error } = await supabase.from("announcements").insert({
          group_id: groupId,
          title: title.trim(),
          content,
          author_id: user?.id,
          ...publication,
        });
        failed = !!error;
      }
    } catch {
      failed = true;
    }

    if (failed) {
      setSaving(false);
      toast.error(failureMessage(announcement ? "save the announcement" : "add the announcement"));
      return;
    }
    // Saving stays set through the navigation: a second click would insert again.
    toast.success(successMessage(choice, fields.published_at, timeZone));
    router.push(listHref);
    router.refresh();
  };

  const handleDelete = async () => {
    if (!announcement) return;
    const { data, error } = await supabase
      .from("announcements")
      .delete()
      .eq("id", announcement.id)
      .eq("group_id", groupId)
      .select("id");
    if (error || !data?.length) {
      toast.error(failureMessage("delete the announcement"));
      return;
    }
    setConfirmingDelete(false);
    toast.success("Announcement deleted.");
    router.push(listHref);
    router.refresh();
  };

  const titleInvalid = invalidFieldProps("title", errors.title);
  const scheduleInvalid = invalidFieldProps("scheduled_at", errors.scheduled_at);

  return (
    <PageContainer size="reading">
      <PageHeader
        title={announcement ? "Edit announcement" : "Add announcement"}
        subtitle={`Posting to ${groupName}`}
        backHref={listHref}
        backLabel="Back to Announcements"
      />
      <Card>
        <CardContent>
          <form onSubmit={handleSubmit} noValidate className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="title" className="text-lg">Title</Label>
              <Input
                id="title"
                name="title"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  if (errors.title) setErrors((prev) => ({ ...prev, title: undefined }));
                }}
                className="text-lg"
                {...titleInvalid}
              />
              <FieldError fieldId="title" message={errors.title} />
            </div>

            <div className="space-y-2">
              <Label id={CONTENT_LABEL_ID} className="text-lg">Content</Label>
              <div className="overflow-hidden rounded-lg border border-border">
                <BlockEditor
                  initialContent={initialBlocks}
                  labelledBy={CONTENT_LABEL_ID}
                  onChange={(blocks) => {
                    blocksRef.current = blocks;
                  }}
                />
              </div>
            </div>

            <div className="space-y-3">
              <p className="text-lg font-medium text-foreground">When to publish</p>
              <Segmented
                label="When to publish"
                options={PUBLISH_CHOICES}
                value={choice}
                onChange={(next) => {
                  setChoice(next);
                  setErrors((prev) => ({ ...prev, scheduled_at: undefined }));
                }}
              />
              {choice === "schedule" && (
                <div className="space-y-2 pt-2">
                  <Label htmlFor="scheduled_at" className="text-lg">Publish on</Label>
                  <Input
                    id="scheduled_at"
                    name="scheduled_at"
                    type="datetime-local"
                    value={scheduledAt}
                    onChange={(e) => {
                      setScheduledAt(e.target.value);
                      if (errors.scheduled_at) setErrors((prev) => ({ ...prev, scheduled_at: undefined }));
                    }}
                    className="text-lg"
                    {...scheduleInvalid}
                    aria-describedby={[ZONE_NOTE_ID, scheduleInvalid["aria-describedby"]]
                      .filter(Boolean)
                      .join(" ")}
                  />
                  <p id={ZONE_NOTE_ID} className="text-base text-muted-foreground">
                    Times are in {zoneName(timeZone)}.
                  </p>
                  <FieldError fieldId="scheduled_at" message={errors.scheduled_at} />
                </div>
              )}
              {choice === "draft" && (
                <p className="text-base text-muted-foreground">
                  Members won&apos;t see it until you publish it.
                </p>
              )}
            </div>

            <div className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row">
              <Button type="submit" size="lg" disabled={saving}>
                {saving ? "Saving…" : SUBMIT_LABEL[choice]}
              </Button>
              <Button size="lg" variant="outline" nativeButton={false} render={<Link href={listHref} />}>
                Cancel
              </Button>
              {announcement && (
                <Button
                  type="button"
                  size="lg"
                  variant="destructive"
                  className="sm:ml-auto"
                  onClick={() => setConfirmingDelete(true)}
                >
                  Delete announcement
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
      {announcement && (
        <ConfirmDialog
          open={confirmingDelete}
          onOpenChange={setConfirmingDelete}
          title={`Delete ${announcement.title}?`}
          description="Members will no longer see it. This can't be undone."
          confirmLabel="Delete announcement"
          pendingLabel="Deleting…"
          onConfirm={handleDelete}
        />
      )}
    </PageContainer>
  );
}

function successMessage(choice: PublishChoice, publishedAt: string | null, timeZone: string): string {
  if (choice === "draft") return "Draft saved.";
  if (choice === "now" || !publishedAt) return "Announcement published.";
  const when = formatInZone(publishedAt, timeZone, {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `Announcement scheduled for ${when}, ${zoneName(timeZone)}.`;
}
