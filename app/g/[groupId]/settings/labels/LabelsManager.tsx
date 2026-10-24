"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { fetchAll } from "@/lib/supabase/fetchAll";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { HEX } from "@/lib/contrast";
import { siteConfig } from "@/lib/config";
import type { GroupLabel } from "@/lib/types";

const UNIQUE_VIOLATION = "23505";

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
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<GroupLabel | null>(null);
  const [deleting, setDeleting] = useState<GroupLabel | null>(null);
  const [form, setForm] = useState<LabelFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deletingBusy, setDeletingBusy] = useState(false);

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
      toast.error("Failed to load labels.");
      setLoading(false);
      return;
    }
    setLabels((labelRows.data ?? []) as GroupLabel[]);
    const countMap: Record<string, number> = {};
    for (const row of appliedRows.data ?? []) {
      countMap[row.label_id] = (countMap[row.label_id] ?? 0) + 1;
    }
    setCounts(countMap);
    setLoading(false);
  }, [supabase, groupId]);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  }

  function openEdit(label: GroupLabel) {
    setEditing(label);
    setForm({ name: label.name, color: label.color });
    setDialogOpen(true);
  }

  async function handleSave() {
    const name = form.name.trim();
    if (!name) {
      toast.error("Label name is required.");
      return;
    }
    if (form.color !== null && !HEX.test(form.color)) {
      toast.error("Color must be a 6-digit hex value such as #B85C38.");
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
        toast.error("A label with that name already exists.");
        return;
      }
      if (error || !data?.length) {
        toast.error("Failed to update label.");
        return;
      }
      toast.success("Label updated.");
    } else {
      const { error } = await supabase
        .from("group_labels")
        .insert({ group_id: groupId, name, color: form.color });
      setSaving(false);
      if (error?.code === UNIQUE_VIOLATION) {
        toast.error("A label with that name already exists.");
        return;
      }
      if (error) {
        toast.error("Failed to create label.");
        return;
      }
      toast.success("Label created.");
    }
    setDialogOpen(false);
    load();
  }

  async function handleDelete() {
    if (!deleting) return;
    setDeletingBusy(true);
    const { data, error } = await supabase
      .from("group_labels")
      .delete()
      .eq("id", deleting.id)
      .eq("group_id", groupId)
      .select("id");
    setDeletingBusy(false);
    if (error || !data?.length) {
      toast.error("Failed to delete label.");
      return;
    }
    toast.success("Label deleted.");
    setDeleting(null);
    load();
  }

  if (loading) {
    return (
      <PageContainer>
        <p className="text-xl text-muted-foreground">Loading...</p>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title="Labels"
        subtitle={`Ways to filter the members of ${groupName}: Men, Women, Tuesday table.`}
        actions={
          <Button
            size="lg"
            onClick={openCreate}
            className="bg-brand-primary text-white hover:bg-brand-primary/90"
          >
            <Plus className="mr-2 h-5 w-5" />
            New label
          </Button>
        }
      />

      {labels.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-base text-muted-foreground">No labels yet.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {labels.map((label) => (
            <Card key={label.id}>
              <CardContent className="flex items-center gap-4 pt-5 pb-5">
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
            <DialogTitle>{editing ? "Edit label" : "New label"}</DialogTitle>
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
                placeholder="e.g. Tuesday table"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="label-color" className="text-base">
                Color
              </Label>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  id="label-color"
                  type="color"
                  value={form.color ?? siteConfig.colors.primary}
                  onChange={(e) => setForm({ ...form, color: e.target.value })}
                  className="h-11 w-11 cursor-pointer rounded border border-input"
                />
                <Input
                  value={form.color ?? ""}
                  onChange={(e) => setForm({ ...form, color: e.target.value || null })}
                  placeholder={siteConfig.colors.primary}
                  aria-label="Color hex value"
                  className="w-32 font-mono text-sm"
                />
                <Button
                  variant="ghost"
                  disabled={form.color === null}
                  onClick={() => setForm({ ...form, color: null })}
                >
                  No color
                </Button>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving}
              className="bg-brand-primary text-white hover:bg-brand-primary/90"
            >
              {saving ? "Saving…" : editing ? "Save changes" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {deleting?.name}?</DialogTitle>
            <DialogDescription className="text-base">
              It will be removed from {memberCountText(deleting ? (counts[deleting.id] ?? 0) : 0)}.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)} disabled={deletingBusy}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deletingBusy}>
              {deletingBusy ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
