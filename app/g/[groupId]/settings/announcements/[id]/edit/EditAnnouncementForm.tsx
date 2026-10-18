"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { groupPath } from "@/lib/groups/active";
import { PostingTo } from "@/components/groups/PostingTo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BlockEditor } from "@/components/editor";
import { toast } from "sonner";
import type { Block, PartialBlock } from "@blocknote/core";
import type { Announcement } from "@/lib/types";

function toLocalDatetime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export function EditAnnouncementForm({
  groupId,
  groupName,
  announcementId,
}: {
  groupId: string;
  groupName: string;
  announcementId: string;
}) {
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "not-found">(
    "loading",
  );
  const [publishNow, setPublishNow] = useState(true);
  const blocksRef = useRef<Block[]>([]);
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const listHref = groupPath(groupId, "/settings/announcements");

  useEffect(() => {
    async function load() {
      const { data, error } = await supabase
        .from("announcements")
        .select("*")
        .eq("id", announcementId)
        .eq("group_id", groupId)
        .maybeSingle();
      if (error || !data) {
        setLoadState("not-found");
        return;
      }
      setAnnouncement(data);
      const isScheduled =
        data.is_published &&
        data.published_at &&
        new Date(data.published_at) > new Date();
      setPublishNow(data.is_published && !isScheduled);
      setLoadState("ready");
    }
    load();
  }, [announcementId, groupId, supabase]);

  const parsedContent = (): PartialBlock[] | undefined => {
    if (!announcement?.content) return undefined;
    try {
      return JSON.parse(announcement.content) as PartialBlock[];
    } catch {
      // Legacy HTML content — can't parse as blocks
      return undefined;
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const scheduledDate = formData.get("scheduled_at") as string;
    const isPublished = publishNow || !!scheduledDate;
    const publishedAt = publishNow
      ? announcement?.published_at && new Date(announcement.published_at) <= new Date()
        ? announcement.published_at // keep original publish date if already published
        : new Date().toISOString()
      : scheduledDate
        ? new Date(scheduledDate).toISOString()
        : null;

    // If the editor was never touched, preserve original content to avoid overwriting with []
    const content = blocksRef.current.length > 0
      ? JSON.stringify(blocksRef.current)
      : announcement!.content;

    const { data, error } = await supabase
      .from("announcements")
      .update({
        title: formData.get("title") as string,
        content,
        is_published: isPublished,
        published_at: publishedAt,
      })
      .eq("id", announcementId)
      .eq("group_id", groupId)
      .select("id");

    setLoading(false);

    if (error || !data?.length) {
      toast.error("Failed to update announcement.");
      return;
    }

    toast.success("Announcement updated!");
    router.push(listHref);
  };

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this announcement?")) return;

    const { data, error } = await supabase
      .from("announcements")
      .delete()
      .eq("id", announcementId)
      .eq("group_id", groupId)
      .select("id");

    if (error || !data?.length) {
      toast.error("Failed to delete announcement.");
      return;
    }

    toast.success("Announcement deleted.");
    router.push(listHref);
  };

  if (loadState === "loading") {
    return (
      <div className="container mx-auto px-4 py-12">
        <p className="text-xl text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (loadState === "not-found" || !announcement) {
    return (
      <div className="container mx-auto px-4 py-12">
        <p className="text-xl text-muted-foreground">
          Announcement not found.{" "}
          <Link href={listHref} className="text-brand-primary hover:underline">
            Back to announcements
          </Link>
        </p>
      </div>
    );
  }

  const isScheduled =
    announcement.is_published &&
    announcement.published_at &&
    new Date(announcement.published_at) > new Date();

  return (
    <div className="container mx-auto px-4 py-12 max-w-4xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-3xl text-brand-primary">Edit Announcement</CardTitle>
          <PostingTo groupName={groupName} />
        </CardHeader>
        <CardContent className="space-y-6">
          <form id="announcement-form" onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="title" className="text-lg">Title</Label>
              <Input
                id="title"
                name="title"
                required
                defaultValue={announcement.title}
                className="text-lg py-6"
              />
            </div>

            <div className="flex items-center gap-3">
              <Switch
                id="publish_now"
                checked={publishNow}
                onCheckedChange={setPublishNow}
              />
              <Label htmlFor="publish_now" className="text-lg">Publish immediately</Label>
            </div>

            {!publishNow && (
              <div className="space-y-2">
                <Label htmlFor="scheduled_at" className="text-lg">
                  Schedule publish date
                </Label>
                <Input
                  id="scheduled_at"
                  name="scheduled_at"
                  type="datetime-local"
                  defaultValue={isScheduled ? toLocalDatetime(announcement.published_at) : ""}
                  className="text-lg py-6"
                />
                <p className="text-sm text-muted-foreground">
                  Leave empty to save as a draft.
                </p>
              </div>
            )}
          </form>

          <div className="space-y-2">
            <Label className="text-lg">Content</Label>
            <div className="rounded-lg overflow-hidden border border-border">
              <BlockEditor
                initialContent={parsedContent()}
                onChange={(blocks) => {
                  blocksRef.current = blocks;
                }}
              />
            </div>
          </div>

          <div className="flex gap-3">
            <Button
              type="submit"
              form="announcement-form"
              size="lg"
              className="flex-1 text-lg py-6 bg-brand-primary hover:bg-brand-primary/90 text-white"
              disabled={loading}
            >
              {loading ? "Saving..." : "Save Changes"}
            </Button>
            <Button
              type="button"
              size="lg"
              variant="destructive"
              className="text-lg py-6"
              onClick={handleDelete}
            >
              Delete
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
