"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { failureMessage } from "@/lib/errorCopy";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SeriesFields } from "./SeriesFields";
import {
  seriesColumns,
  validateSeries,
  type SeriesDraft,
  type SeriesFieldErrors,
  type SeriesOption,
} from "./lessonDraft";

const EMPTY: SeriesDraft = { name: "", teacher: "" };
const ID_PREFIX = "new-series-";

/** Adds a series without leaving the lesson form, then hands it back. */
export function AddSeriesDialog({
  groupId,
  open,
  onOpenChange,
  onAdded,
}: {
  groupId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: (series: SeriesOption) => void;
}) {
  const [draft, setDraft] = useState<SeriesDraft>(EMPTY);
  const [errors, setErrors] = useState<SeriesFieldErrors>({});
  // An object, so a second submit with the same error still refocuses.
  const [focusTarget, setFocusTarget] = useState<{ id: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const close = (next: boolean) => {
    if (saving) return;
    if (!next) {
      setDraft(EMPTY);
      setErrors({});
    }
    onOpenChange(next);
  };

  // Focus waits for the render that ties the message to the field.
  useEffect(() => {
    if (focusTarget) document.getElementById(focusTarget.id)?.focus();
  }, [focusTarget]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const found = validateSeries(draft);
    setErrors(found);
    if (found.name) {
      setFocusTarget({ id: `${ID_PREFIX}name` });
      return;
    }

    setSaving(true);
    const { data, error } = await createClient()
      .from("lecture_series")
      .insert({ group_id: groupId, ...seriesColumns(draft) })
      .select("id, name, teacher")
      .single();
    setSaving(false);

    if (error || !data) {
      toast.error(failureMessage("add the series"));
      return;
    }
    toast.success("Series added.");
    onAdded(data);
    setDraft(EMPTY);
    setErrors({});
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add series</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} noValidate className="space-y-6">
          <SeriesFields
            draft={draft}
            errors={errors}
            idPrefix={ID_PREFIX}
            onChange={(next) => {
              if (next.name !== draft.name) setErrors({});
              setDraft(next);
            }}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => close(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Adding…" : "Add series"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
