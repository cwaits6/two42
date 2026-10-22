"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { RosterLabel } from "@/components/directory/useGroupRoster";
import type { GroupRole } from "@/lib/groups/active";

const ROLE_OPTIONS: { value: GroupRole; label: string }[] = [
  { value: "leader", label: "Leader" },
  { value: "member", label: "Member" },
];

export interface EditMemberChanges {
  role: GroupRole;
  addLabelIds: string[];
  removeLabelIds: string[];
}

interface EditMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  personName: string;
  role: GroupRole;
  labels: RosterLabel[];
  appliedLabelIds: ReadonlySet<string>;
  groupName: string;
  orgName: string;
  /** The viewer's own row: the role cannot be changed from here. */
  isSelf: boolean;
  onSave: (changes: EditMemberChanges) => Promise<void>;
}

export function EditMemberDialog({
  open,
  onOpenChange,
  personName,
  role,
  labels,
  appliedLabelIds,
  groupName,
  orgName,
  isSelf,
  onSave,
}: EditMemberDialogProps) {
  // Mounted fresh per person (keyed by the caller), so the draft starts
  // from the row once and survives a failed save.
  const [draftRole, setDraftRole] = useState<GroupRole>(role);
  const [draftLabels, setDraftLabels] = useState<ReadonlySet<string>>(appliedLabelIds);
  const [saving, setSaving] = useState(false);

  function toggleLabel(id: string, checked: boolean) {
    setDraftLabels((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    await onSave({
      role: draftRole,
      addLabelIds: [...draftLabels].filter((id) => !appliedLabelIds.has(id)),
      removeLabelIds: [...appliedLabelIds].filter((id) => !draftLabels.has(id)),
    });
    setSaving(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit member</DialogTitle>
          <DialogDescription className="text-base">{personName}</DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-2">
          <div className="space-y-2">
            <Label htmlFor="member-role" className="text-base">
              Role
            </Label>
            <Select
              items={ROLE_OPTIONS}
              value={draftRole}
              onValueChange={(v) => setDraftRole(v as GroupRole)}
              disabled={isSelf}
            >
              <SelectTrigger id="member-role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLE_OPTIONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isSelf && (
              <p className="text-sm text-muted-foreground">
                Another leader can change your role.
              </p>
            )}
          </div>

          {labels.length > 0 && (
            <fieldset className="space-y-1">
              <legend className="mb-2 text-base font-medium">Labels</legend>
              {labels.map((label) => {
                const id = `member-label-${label.id}`;
                return (
                  <div key={label.id} className="flex min-h-11 items-center gap-3">
                    <Checkbox
                      id={id}
                      checked={draftLabels.has(label.id)}
                      onCheckedChange={(checked) => toggleLabel(label.id, checked)}
                    />
                    <Label htmlFor={id} className="flex-1 cursor-pointer text-base">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: label.color ?? "var(--color-brand-neutral)" }}
                        aria-hidden="true"
                      />
                      {label.name}
                    </Label>
                  </div>
                );
              })}
            </fieldset>
          )}

          <p className="text-sm text-muted-foreground">
            In {groupName} only. Their {orgName} profile does not change.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={save}
            disabled={saving}
            className="bg-brand-primary text-white hover:bg-brand-primary/90"
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
