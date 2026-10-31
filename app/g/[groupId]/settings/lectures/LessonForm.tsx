"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { failureMessage } from "@/lib/errorCopy";
import { groupPath } from "@/lib/groups/active";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FieldError, invalidFieldProps } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { AddSeriesDialog } from "./AddSeriesDialog";
import {
  lessonColumns,
  seriesItems,
  validateLesson,
  withAddedSeries,
  type LessonDraft,
  type LessonFieldErrors,
  type SeriesOption,
} from "./lessonDraft";

function Optional() {
  return <span className="font-normal text-muted-foreground">(optional)</span>;
}

/** Adds a lesson, or edits one when `lesson` is given. */
export function LessonForm({
  groupId,
  series: initialSeries,
  initial,
  lesson,
}: {
  groupId: string;
  series: SeriesOption[];
  initial: LessonDraft;
  lesson?: { id: string; title: string };
}) {
  const router = useRouter();
  const [form, setForm] = useState({ draft: initial, series: initialSeries });
  const [errors, setErrors] = useState<LessonFieldErrors>({});
  // An object, so a second submit with the same first error still refocuses.
  const [focusTarget, setFocusTarget] = useState<{ id: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [addingSeries, setAddingSeries] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const listHref = groupPath(groupId, "/settings/lectures");
  const { draft } = form;
  const items = seriesItems(form.series);

  // Focus waits for the render that ties the message to the field.
  useEffect(() => {
    if (focusTarget) document.getElementById(focusTarget.id)?.focus();
  }, [focusTarget]);

  const update = <K extends keyof LessonDraft>(key: K, value: LessonDraft[K]) => {
    setForm((prev) => ({ ...prev, draft: { ...prev.draft, [key]: value } }));
    if (key in errors) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[key as keyof LessonFieldErrors];
        return next;
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const found = validateLesson(draft);
    setErrors(found);
    const first = Object.keys(found)[0];
    if (first) {
      setFocusTarget({ id: first });
      return;
    }

    setSaving(true);
    const supabase = createClient();
    const columns = lessonColumns(draft);
    let saved: boolean;
    if (lesson) {
      const { data, error } = await supabase
        .from("lectures")
        .update(columns)
        .eq("id", lesson.id)
        .eq("group_id", groupId)
        .select("id");
      saved = !error && !!data?.length;
    } else {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("lectures")
        .insert({ ...columns, group_id: groupId, created_by: user?.id });
      saved = !error;
    }
    setSaving(false);

    if (!saved) {
      toast.error(failureMessage(lesson ? "save the lesson" : "add the lesson"));
      return;
    }
    toast.success(lesson ? "Lesson saved." : "Lesson added.");
    router.push(listHref);
  };

  const handleDelete = async () => {
    if (!lesson) return;
    const { data, error } = await createClient()
      .from("lectures")
      .delete()
      .eq("id", lesson.id)
      .eq("group_id", groupId)
      .select("id");

    if (error || !data?.length) {
      toast.error(failureMessage("delete the lesson"));
      return;
    }
    toast.success("Lesson deleted.");
    router.push(listHref);
  };

  return (
    <>
      <Card>
        <CardContent>
          <form onSubmit={handleSubmit} noValidate className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="series_id" className="text-lg">
                Series
              </Label>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Select
                  items={items}
                  value={draft.series_id}
                  onValueChange={(v) => v && update("series_id", v)}
                >
                  <SelectTrigger id="series_id" className="w-full min-h-12 text-base sm:flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {items.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button type="button" variant="outline" onClick={() => setAddingSeries(true)}>
                  <Plus aria-hidden="true" />
                  Add series
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="title" className="text-lg">
                Title
              </Label>
              <Input
                id="title"
                value={draft.title}
                onChange={(e) => update("title", e.target.value)}
                className="text-lg py-6"
                {...invalidFieldProps("title", errors.title)}
              />
              <FieldError fieldId="title" message={errors.title} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="video_url" className="text-lg">
                Recording link
              </Label>
              <Input
                id="video_url"
                type="url"
                inputMode="url"
                value={draft.video_url}
                onChange={(e) => update("video_url", e.target.value)}
                placeholder="https://youtube.com/watch?v=…"
                className="text-lg py-6"
                {...invalidFieldProps("video_url", errors.video_url)}
              />
              <FieldError fieldId="video_url" message={errors.video_url} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="lecture_date" className="text-lg">
                Date <Optional />
              </Label>
              <Input
                id="lecture_date"
                type="date"
                value={draft.lecture_date}
                onChange={(e) => update("lecture_date", e.target.value)}
                className="text-lg py-6"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description" className="text-lg">
                Description <Optional />
              </Label>
              <Textarea
                id="description"
                rows={2}
                value={draft.description}
                onChange={(e) => update("description", e.target.value)}
                placeholder="One or two sentences about the lesson"
                className="text-lg"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="summary" className="text-lg">
                Lesson summary <Optional />
              </Label>
              <Textarea
                id="summary"
                rows={6}
                value={draft.summary}
                onChange={(e) => update("summary", e.target.value)}
                placeholder="What was taught, for anyone who missed it"
                className="text-lg"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="thumbnail_url" className="text-lg">
                Thumbnail link <Optional />
              </Label>
              <Input
                id="thumbnail_url"
                type="url"
                inputMode="url"
                value={draft.thumbnail_url}
                onChange={(e) => update("thumbnail_url", e.target.value)}
                className="text-lg py-6"
                {...invalidFieldProps("thumbnail_url", errors.thumbnail_url)}
              />
              <p className="text-base text-muted-foreground">
                Leave it empty to use the YouTube thumbnail.
              </p>
              <FieldError fieldId="thumbnail_url" message={errors.thumbnail_url} />
            </div>

            <div className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row">
              <Button type="submit" size="lg" disabled={saving}>
                {saving ? "Saving…" : "Save lesson"}
              </Button>
              <Button
                type="button"
                size="lg"
                variant="outline"
                onClick={() => router.push(listHref)}
                disabled={saving}
              >
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {lesson && (
        <div className="mt-8">
          <Button variant="destructive" size="lg" onClick={() => setConfirmingDelete(true)}>
            Delete lesson
          </Button>
          <ConfirmDialog
            open={confirmingDelete}
            onOpenChange={setConfirmingDelete}
            title={`Delete ${lesson.title}?`}
            description="Its recording link and lesson summary go with it. This can't be undone."
            confirmLabel="Delete lesson"
            pendingLabel="Deleting…"
            onConfirm={handleDelete}
          />
        </div>
      )}

      <AddSeriesDialog
        groupId={groupId}
        open={addingSeries}
        onOpenChange={setAddingSeries}
        onAdded={(added) => setForm((prev) => withAddedSeries(prev, added))}
      />
    </>
  );
}
