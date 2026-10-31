"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { failureMessage } from "@/lib/errorCopy";
import { groupPath } from "@/lib/groups/active";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SeriesFields } from "../SeriesFields";
import {
  seriesColumns,
  validateSeries,
  type SeriesDraft,
  type SeriesFieldErrors,
} from "../lessonDraft";

/** Adds a series, or edits one when `series` is given. */
export function SeriesForm({
  groupId,
  series,
}: {
  groupId: string;
  series?: { id: string; name: string; teacher: string | null; is_archived: boolean };
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<SeriesDraft>({
    name: series?.name ?? "",
    teacher: series?.teacher ?? "",
  });
  const [isPast, setIsPast] = useState(series?.is_archived ?? false);
  const [errors, setErrors] = useState<SeriesFieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const listHref = groupPath(groupId, "/settings/lectures/series");

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const found = validateSeries(draft);
    setErrors(found);
    if (found.name) {
      document.getElementById("name")?.focus();
      return;
    }

    setSaving(true);
    const supabase = createClient();
    let saved: boolean;
    if (series) {
      const { data, error } = await supabase
        .from("lecture_series")
        .update({ ...seriesColumns(draft), is_archived: isPast })
        .eq("id", series.id)
        .eq("group_id", groupId)
        .select("id");
      saved = !error && !!data?.length;
    } else {
      const { error } = await supabase
        .from("lecture_series")
        .insert({ ...seriesColumns(draft), group_id: groupId });
      saved = !error;
    }
    setSaving(false);

    if (!saved) {
      toast.error(failureMessage(series ? "save the series" : "add the series"));
      return;
    }
    toast.success(series ? "Series saved." : "Series added.");
    router.push(listHref);
  };

  const handleDelete = async () => {
    if (!series) return;
    const { data, error } = await createClient()
      .from("lecture_series")
      .delete()
      .eq("id", series.id)
      .eq("group_id", groupId)
      .select("id");

    if (error || !data?.length) {
      toast.error(failureMessage("delete the series"));
      return;
    }
    toast.success("Series deleted.");
    router.push(listHref);
  };

  return (
    <>
      <Card>
        <CardContent>
          <form onSubmit={handleSubmit} noValidate className="space-y-6">
            <SeriesFields
              draft={draft}
              errors={errors}
              onChange={(next) => {
                if (next.name !== draft.name) setErrors({});
                setDraft(next);
              }}
            />

            {series && (
              <div className="flex items-start justify-between gap-4">
                <div>
                  <Label htmlFor="is_past" className="text-lg">
                    Past series
                  </Label>
                  <p className="text-base text-muted-foreground">
                    Lists it under Past series on the Lessons page.
                  </p>
                </div>
                <Switch id="is_past" checked={isPast} onCheckedChange={setIsPast} />
              </div>
            )}

            <div className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row">
              <Button type="submit" size="lg" disabled={saving}>
                {saving ? "Saving…" : "Save series"}
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

      {series && (
        <div className="mt-8">
          <Button variant="destructive" size="lg" onClick={() => setConfirmingDelete(true)}>
            Delete series
          </Button>
          <ConfirmDialog
            open={confirmingDelete}
            onOpenChange={setConfirmingDelete}
            title={`Delete ${series.name}?`}
            description="Its lessons stay, but no longer belong to a series."
            confirmLabel="Delete series"
            pendingLabel="Deleting…"
            onConfirm={handleDelete}
          />
        </div>
      )}
    </>
  );
}
