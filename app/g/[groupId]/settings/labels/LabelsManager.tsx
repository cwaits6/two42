"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Tag, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { fetchAll } from "@/lib/supabase/fetchAll";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldError, invalidFieldProps } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/states/EmptyState";
import { ErrorState } from "@/components/states/ErrorState";
import { LoadingState } from "@/components/states/LoadingState";
import { siteConfig } from "@/lib/config";
import { groupPath } from "@/lib/groups/active";
import type { GroupLabel } from "@/lib/types";
import { labelFormErrors, type LabelFormErrors } from "./labelForm";

const UNIQUE_VIOLATION = "23505";
const DUPLICATE_NAME = "A label with that name already exists. Enter a different name.";

interface LabelFormState {
  name: string;
  /** Null is "no color"; the dot falls back to the neutral tone. */
  color: string | null;
}

const EMPTY_FORM: LabelFormState = { name: "", color: siteConfig.colors.primary };

function memberCountText(n: number): string {
  return `${n} member${n === 1 ? "" : "s"}`;
}

interface LabelsManagerProps {
  groupId: string;
  groupName: string;
}

export function LabelsManager({ groupId, groupName }: LabelsManagerProps) {
  const supabase = useMemo(() => createClient(), []);
  const [labels, setLabels] = useState<GroupLabel[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<GroupLabel | null>(null);
  const [deleting, setDeleting] = useState<GroupLabel | null>(null);
  const [form, setForm] = useState<LabelFormState>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<LabelFormErrors>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [labelRows, appliedRows] = await Promise.all([
      supabase.from("group_labels").select("*").eq("group_id", groupId).order("name"),
      fetchAll((from, to) =>
        supabase
          .from("group_member_labels")
          .select("label_id")
          .eq("group_id", groupId)
          .order("group_member_id")
          .order("label_id")
          .range(from, to),
      ),
    ]);
    if (labelRows.error || appliedRows.error) {
      console.error("Failed to load labels:", labelRows.error ?? appliedRows.error);
      setLoadFailed(true);
      setLoading(false);
      return;
    }
    setLabels((labelRows.data ?? []) as GroupLabel[]);
    const countMap: Record<string, number> = {};
    for (const row of appliedRows.data ?? []) {
      countMap[row.label_id] = (countMap[row.label_id] ?? 0) + 1;
    }
    setCounts(countMap);
    setLoadFailed(false);
    setLoading(false);
  }, [supabase, groupId]);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormErrors({});
    setDialogOpen(true);
  }

  function openEdit(label: GroupLabel) {
    setEditing(label);
    setForm({ name: label.name, color: label.color });
    setFormErrors({});
    setDialogOpen(true);
  }

  async function handleSave() {
    const name = form.name.trim();
    const found = labelFormErrors(form);
    setFormErrors(found);
    if (found.name) {
      document.getElementById("label-name")?.focus();
      return;
    }
    if (found.color) {
      document.getElementById("label-color")?.focus();
      return;
    }

    setSaving(true);
    if (editing) {
      const { data, error } = await supabase
        .from("group_labels")
        .update({ name, color: form.color })
        .eq("id", editing.id)
        .eq("group_id", groupId)
        .select("id");
      setSaving(false);
      if (error?.code === UNIQUE_VIOLATION) {
        setFormErrors({ name: DUPLICATE_NAME });
        document.getElementById("label-name")?.focus();
        return;
      }
      if (error || !data?.length) {
        toast.error("Couldn't save the label. Try again.");
        return;
      }
      toast.success("Label saved.");
    } else {
      const { error } = await supabase
        .from("group_labels")
        .insert({ group_id: groupId, name, color: form.color });
      setSaving(false);
      if (error?.code === UNIQUE_VIOLATION) {
        setFormErrors({ name: DUPLICATE_NAME });
        document.getElementById("label-name")?.focus();
        return;
      }
      if (error) {
        toast.error("Couldn't add the label. Try again.");
        return;
      }
      toast.success("Label added.");
    }
    setDialogOpen(false);
    load();
  }

  async function handleDelete() {
    if (!deleting) return;
    const { data, error } = await supabase
      .from("group_labels")
      .delete()
      .eq("id", deleting.id)
      .eq("group_id", groupId)
      .select("id");
    if (error || !data?.length) {
      toast.error("Couldn't delete the label. Try again.");
      return;
    }
    toast.success("Label deleted.");
    setDeleting(null);
    load();
  }

  return (
    <PageContainer>
      <PageHeader
        title="Labels"
        subtitle={`Ways to filter the members of ${groupName}: Men, Women, Tuesday table.`}
        backHref={groupPath(groupId, "/settings")}
        backLabel="Back to Group settings"
        actions={
          <Button size="lg" onClick={openCreate}>
            <Plus className="mr-2 h-5 w-5" />
            Add label
          </Button>
        }
      />

      {loading ? (
        <LoadingState thing="labels" />
      ) : loadFailed ? (
        <ErrorState thing="labels" onRetry={load} />
      ) : labels.length === 0 ? (
        <EmptyState
          icon={Tag}
          message="No labels yet. Add one, then apply it to members in the Directory."
        />
      ) : (
        <div className="space-y-3">
          {labels.map((label) => (
            <Card key={label.id}>
              <CardContent className="flex flex-wrap items-center gap-4 pt-5 pb-5">
                <span
                  className="h-4 w-4 shrink-0 rounded-full"
                  style={{ backgroundColor: label.color ?? "var(--color-brand-neutral)" }}
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{label.name}</p>
                  <p className="text-base text-muted-foreground">
                    {memberCountText(counts[label.id] ?? 0)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button variant="outline" onClick={() => openEdit(label)} aria-label={`Edit ${label.name}`}>
                    <Pencil aria-hidden="true" />
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setDeleting(label)}
                    aria-label={`Delete ${label.name}`}
                  >
                    <Trash2 aria-hidden="true" />
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit label" : "Add label"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="label-name" className="text-base">
                Label name
              </Label>
              <Input
                id="label-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Tuesday table"
                className="text-base"
                {...invalidFieldProps("label-name", formErrors.name)}
              />
              <FieldError fieldId="label-name" message={formErrors.name} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="label-color" className="text-base">
                Color
              </Label>
              <div className="flex flex-wrap items-center gap-3">
                <input
                  id="label-color"
                  type="color"
                  value={form.color ?? siteConfig.colors.primary}
                  onChange={(e) => setForm({ ...form, color: e.target.value })}
                  className="block h-12 w-20 cursor-pointer rounded-md border border-input p-1"
                  {...invalidFieldProps("label-color", formErrors.color)}
                />
                <Button
                  variant="outline"
                  disabled={form.color === null}
                  onClick={() => setForm({ ...form, color: null })}
                >
                  No color
                </Button>
              </div>
              {form.color === null && (
                <p className="text-base text-muted-foreground">
                  This label has no color. Choose one above to add it.
                </p>
              )}
              <FieldError fieldId="label-color" message={formErrors.color} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? "Saving…" : editing ? "Save changes" : "Add label"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete ${deleting?.name ?? "label"}?`}
        description={`It will be removed from ${memberCountText(deleting ? (counts[deleting.id] ?? 0) : 0)}.`}
        confirmLabel="Delete label"
        pendingLabel="Deleting…"
        onConfirm={handleDelete}
      />
    </PageContainer>
  );
}
