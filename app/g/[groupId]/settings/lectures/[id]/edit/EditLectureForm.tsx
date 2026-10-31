"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { groupPath } from "@/lib/groups/active";
import { PostingTo } from "@/components/groups/PostingTo";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

type Lecture = {
  id: string;
  group_id: string;
  title: string;
  description: string | null;
  video_url: string;
  thumbnail_url: string | null;
  lecture_date: string | null;
  week_number: number | null;
  scripture_reference: string | null;
  summary: string | null;
  series_id: string | null;
  created_by: string | null;
};

export function EditLectureForm({
  groupId,
  groupName,
  lectureId,
}: {
  groupId: string;
  groupName: string;
  lectureId: string;
}) {
  const [lecture, setLecture] = useState<Lecture | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "not-found">(
    "loading",
  );
  const [seriesList, setSeriesList] = useState<{ id: string; name: string; teacher: string | null }[]>([]);
  const [seriesId, setSeriesId] = useState("none");
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const base = groupPath(groupId, "/settings/lectures");

  useEffect(() => {
    async function load() {
      try {
        const [
          { data: lectureData, error: lectureError },
          { data: seriesData },
        ] = await Promise.all([
          supabase
            .from("lectures")
            .select("*")
            .eq("id", lectureId)
            .eq("group_id", groupId)
            .maybeSingle(),
          supabase
            .from("lecture_series")
            .select("id, name, teacher")
            .eq("group_id", groupId)
            .order("created_at", { ascending: false }),
        ]);
        setSeriesList(seriesData ?? []);
        if (lectureError || !lectureData) {
          setLoadState("not-found");
          return;
        }
        setLecture(lectureData as Lecture);
        setSeriesId((lectureData as Lecture).series_id ?? "none");
        setLoadState("ready");
      } catch (err) {
        console.error("Failed to load lecture", err);
        setLoadState("not-found");
      }
    }
    load();
  }, [lectureId, groupId, supabase]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);

    const formData = new FormData(e.currentTarget);

    const { data, error } = await supabase
      .from("lectures")
      .update({
        title: formData.get("title") as string,
        description: (formData.get("description") as string) || null,
        video_url: formData.get("video_url") as string,
        thumbnail_url: (formData.get("thumbnail_url") as string) || null,
        lecture_date: (formData.get("lecture_date") as string) || null,
        series_id: seriesId === "none" ? null : seriesId,
        summary: (formData.get("summary") as string) || null,
      })
      .eq("id", lectureId)
      .eq("group_id", groupId)
      .select("id");

    setLoading(false);

    if (error || !data?.length) {
      toast.error("Failed to update lecture.");
      return;
    }

    toast.success("Lecture updated.");
    router.push(base);
  };

  const handleDelete = async () => {
    const { data, error } = await supabase
      .from("lectures")
      .delete()
      .eq("id", lectureId)
      .eq("group_id", groupId)
      .select("id");

    if (error || !data?.length) {
      toast.error("Failed to delete lecture.");
      return;
    }

    toast.success("Lecture deleted.");
    router.push(base);
  };

  if (loadState === "loading") {
    return (
      <div className="container mx-auto px-4 py-12">
        <p className="text-xl text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (loadState === "not-found" || !lecture) {
    return (
      <div className="container mx-auto px-4 py-12">
        <p className="text-xl text-muted-foreground">
          Lecture not found.{" "}
          <Link href={base} className="text-brand-primary-text hover:underline">
            Back to lectures
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-12 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-3xl text-brand-primary-text">Edit Lecture</CardTitle>
          <PostingTo groupName={groupName} />
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Series */}
            <div className="space-y-2">
              <Label htmlFor="series_id" className="text-lg">Series</Label>
              <Select
                items={[
                  { value: "none", label: "No series" },
                  ...seriesList.map((s) => ({
                    value: s.id,
                    label: `${s.name}${s.teacher ? ` — ${s.teacher}` : ""}`,
                  })),
                ]}
                value={seriesId}
                onValueChange={(v) => setSeriesId(v ?? "none")}
              >
                <SelectTrigger id="series_id" className="w-full text-base py-5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No series</SelectItem>
                  {seriesList.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}{s.teacher ? ` — ${s.teacher}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Title */}
            <div className="space-y-2">
              <Label htmlFor="title" className="text-lg">Title</Label>
              <Input
                id="title"
                name="title"
                required
                defaultValue={lecture.title}
                className="text-lg py-6"
              />
            </div>

            {/* Video URL */}
            <div className="space-y-2">
              <Label htmlFor="video_url" className="text-lg">Video URL</Label>
              <Input
                id="video_url"
                name="video_url"
                type="url"
                required
                placeholder="https://youtube.com/watch?v=..."
                defaultValue={lecture.video_url}
                className="text-lg py-6"
              />
            </div>

            {/* Lecture date */}
            <div className="space-y-2">
              <Label htmlFor="lecture_date" className="text-lg">Lecture Date</Label>
              <Input
                id="lecture_date"
                name="lecture_date"
                type="date"
                defaultValue={lecture.lecture_date ?? ""}
                className="text-lg py-6"
              />
            </div>

            {/* Summary */}
            <div className="space-y-2">
              <Label htmlFor="summary" className="text-lg">Summary</Label>
              <Textarea
                id="summary"
                name="summary"
                rows={4}
                placeholder="Summary of the teaching..."
                defaultValue={lecture.summary ?? ""}
                className="text-lg"
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="description" className="text-lg">Description</Label>
              <Textarea
                id="description"
                name="description"
                rows={2}
                placeholder="Short description (optional)"
                defaultValue={lecture.description ?? ""}
                className="text-lg"
              />
            </div>

            {/* Thumbnail URL */}
            <div className="space-y-2">
              <Label htmlFor="thumbnail_url" className="text-lg">
                Thumbnail URL{" "}
                <span className="text-muted-foreground">(optional, auto-detected for YouTube)</span>
              </Label>
              <Input
                id="thumbnail_url"
                name="thumbnail_url"
                type="url"
                defaultValue={lecture.thumbnail_url ?? ""}
                className="text-lg py-6"
              />
            </div>

            <div className="flex gap-3">
              <Button
                type="submit"
                size="lg"
                className="flex-1 text-lg py-6"
                disabled={loading}
              >
                {loading ? "Saving..." : "Save Changes"}
              </Button>
              <Button
                type="button"
                size="lg"
                variant="destructive"
                className="text-lg py-6"
                onClick={() => setConfirmingDelete(true)}
              >
                Delete
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title="Delete this lecture?"
        description="This can't be undone."
        confirmLabel="Delete lecture"
        pendingLabel="Deleting…"
        onConfirm={handleDelete}
      />
    </div>
  );
}
