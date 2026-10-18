"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";

export function GroupDetailsForm({
  groupId,
  initialName,
  initialDescription,
}: {
  groupId: string;
  initialName: string;
  initialDescription: string | null;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Enter a group name.");
      return;
    }
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
      toast.error("Couldn't save the group. Please try again.");
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
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          required
          className="h-12 text-base"
        />
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
      <Button
        type="submit"
        size="lg"
        disabled={saving}
        className="bg-brand-primary hover:bg-brand-primary/90 text-white"
      >
        {saving ? "Saving…" : "Save changes"}
      </Button>
    </form>
  );
}
