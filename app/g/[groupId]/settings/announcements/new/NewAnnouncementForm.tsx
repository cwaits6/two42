"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { groupPath } from "@/lib/groups/active";
import { PostingTo } from "@/components/groups/PostingTo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BlockEditor } from "@/components/editor";
import type { CuratedBlock } from "@/components/editor/schema";
import { toast } from "sonner";

export function NewAnnouncementForm({
  groupId,
  groupName,
}: {
  groupId: string;
  groupName: string;
}) {
  const [loading, setLoading] = useState(false);
  const [publishNow, setPublishNow] = useState(true);
  const blocksRef = useRef<CuratedBlock[]>([]);
  const router = useRouter();
  const supabase = createClient();

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const { data: { user } } = await supabase.auth.getUser();

    const scheduledDate = formData.get("scheduled_at") as string;
    const isPublished = publishNow || !!scheduledDate;
    const publishedAt = publishNow
      ? new Date().toISOString()
      : scheduledDate
        ? new Date(scheduledDate).toISOString()
        : null;

    const { error } = await supabase.from("announcements").insert({
      group_id: groupId,
      title: formData.get("title") as string,
      content: JSON.stringify(blocksRef.current),
      is_published: isPublished,
      published_at: publishedAt,
      author_id: user?.id,
    });

    setLoading(false);

    if (error) {
      toast.error("Failed to create announcement.");
      return;
    }

    toast.success(
      publishNow
        ? "Announcement published!"
        : scheduledDate
          ? `Announcement scheduled for ${new Date(scheduledDate).toLocaleString()}.`
          : "Announcement saved as draft."
    );
    router.push(groupPath(groupId, "/settings/announcements"));
  };

  return (
    <div className="container mx-auto px-4 py-12 max-w-4xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-3xl text-brand-primary">New Announcement</CardTitle>
          <PostingTo groupName={groupName} />
        </CardHeader>
        <CardContent className="space-y-6">
          <form id="announcement-form" onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="title" className="text-lg">Title</Label>
              <Input id="title" name="title" required className="text-lg py-6" />
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
                onChange={(blocks) => {
                  blocksRef.current = blocks;
                }}
              />
            </div>
          </div>

          <Button
            type="submit"
            form="announcement-form"
            size="lg"
            className="w-full text-lg py-6"
            disabled={loading}
          >
            {loading
              ? "Creating..."
              : publishNow
                ? "Publish Announcement"
                : "Save Announcement"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
