"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FieldError, invalidFieldProps } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";

export function GroupDetailsForm({
  groupId,
  cancelHref,
  initialName,
  initialDescription,
}: {
  groupId: string;
  cancelHref: string;
  initialName: string;
  initialDescription: string | null;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription ?? "");
  const [nameError, setNameError] = useState<string>();
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError("Enter a group name.");
      document.getElementById("group-name")?.focus();
      return;
    }
    setNameError(undefined);
    setSaving(true);
    const supabase = createClient();
    // The "Leaders and admins can update groups" policy is the authority on
    // who may save; a non-leader's write matches zero rows.
    const { data, error } = await supabase
      .from("groups")
      .update({ name: trimmed, description: description.trim() || null })
      .eq("id", groupId)
      .select("id");
    setSaving(false);
    if (error || !data?.length) {
      toast.error("Couldn't save the group. Try again.");
      return;
    }
    toast.success("Group saved.");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="group-name" className="text-base">
          Group name
        </Label>
        <Input
          id="group-name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setNameError(undefined);
          }}
          maxLength={120}
          className="h-12 text-base"
          {...invalidFieldProps("group-name", nameError)}
        />
        <FieldError fieldId="group-name" message={nameError} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="group-description" className="text-base">
          Description
        </Label>
        <Textarea
          id="group-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          maxLength={1000}
          className="text-base"
        />
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button type="submit" size="lg" disabled={saving}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
        <Button size="lg" variant="outline" nativeButton={false} render={<Link href={cancelHref} />}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
