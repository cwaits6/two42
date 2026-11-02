"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useLeaveGuard } from "@/components/useLeaveGuard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldError, invalidFieldProps } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { failureMessage } from "@/lib/errorCopy";
import { groupPath } from "@/lib/groups/active";
import { createClient } from "@/lib/supabase/client";
import { hasChanges } from "../../about/edit/aboutChanges";
import { colorError, detailsChanges, videoCallUrlError, type DetailsFields } from "./detailsChanges";

type FieldErrors = { name?: string; color?: string; videoCallUrl?: string };

export function GroupDetailsForm({
  groupId,
  cancelHref,
  initialName,
  initialDescription,
  initialColor,
  initialVideoCallUrl,
  initialVideoCallTime,
}: {
  groupId: string;
  cancelHref: string;
  initialName: string;
  initialDescription: string | null;
  initialColor: string;
  initialVideoCallUrl: string;
  initialVideoCallTime: string;
}) {
  const router = useRouter();
  const [savedGroup, setSavedGroup] = useState({
    name: initialName,
    description: initialDescription ?? "",
  });
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription ?? "");
  const [saved, setSaved] = useState<DetailsFields>({
    color: initialColor,
    videoCallUrl: initialVideoCallUrl,
    videoCallTime: initialVideoCallTime,
  });
  const [draft, setDraft] = useState(saved);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);

  const trimmedName = name.trim();
  const trimmedDescription = description.trim();
  const groupChanged =
    trimmedName !== savedGroup.name || trimmedDescription !== savedGroup.description;
  const changes = detailsChanges(saved, draft);
  const dirty = groupChanged || hasChanges(changes);
  const leaveGuard = useLeaveGuard(dirty);

  const setField = <K extends keyof DetailsFields>(key: K, value: DetailsFields[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const found: FieldErrors = {
      name: trimmedName ? undefined : "Enter a group name.",
      color: colorError(draft.color),
      videoCallUrl: videoCallUrlError(draft.videoCallUrl),
    };
    setErrors(found);
    const firstInvalid = found.name
      ? "group-name"
      : found.color
        ? "group-color"
        : found.videoCallUrl
          ? "weekly-zoom-url"
          : null;
    if (firstInvalid) {
      document.getElementById(firstInvalid)?.focus();
      return;
    }

    setSaving(true);
    if (groupChanged) {
      // The "Leaders and admins can update groups" policy is the authority on
      // who may save; a non-leader's write matches zero rows.
      const { data, error } = await createClient()
        .from("groups")
        .update({ name: trimmedName, description: trimmedDescription || null })
        .eq("id", groupId)
        .select("id");
      if (error || !data?.length) {
        setSaving(false);
        toast.error("Couldn't save the group. Try again.");
        return;
      }
      setSavedGroup({ name: trimmedName, description: trimmedDescription });
    }

    if (hasChanges(changes)) {
      let failure: number | "network" | null;
      try {
        const res = await fetch(groupPath(groupId, "/about/save"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(changes),
        });
        failure = res.ok ? null : res.status;
      } catch {
        failure = "network";
      }
      if (failure !== null) {
        setSaving(false);
        toast.error(failureMessage("save the group", failure));
        return;
      }
      // Only the baseline moves: the fields stay live during the request, so
      // anything typed since it was sent must stay on screen and stay unsaved.
      setSaved({
        ...draft,
        videoCallUrl: draft.videoCallUrl.trim(),
        videoCallTime: draft.videoCallTime.trim(),
      });
    }

    setSaving(false);
    toast.success("Group saved.");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-8">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl font-bold text-foreground">Name and description</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="text-base text-muted-foreground">
            What members see on Home and in the switcher.
          </p>
          <div className="space-y-2">
            <Label htmlFor="group-name" className="text-base">
              Group name
            </Label>
            <Input
              id="group-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setErrors((prev) => ({ ...prev, name: undefined }));
              }}
              maxLength={120}
              className="h-12 text-base"
              {...invalidFieldProps("group-name", errors.name)}
            />
            <FieldError fieldId="group-name" message={errors.name} />
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-xl font-bold text-foreground">Group color</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-base text-muted-foreground">
            Used for the group in the switcher, on Home and on calendar events.
          </p>
          <div className="space-y-2">
            <Label htmlFor="group-color" className="text-base">Color</Label>
            <input
              id="group-color"
              type="color"
              value={draft.color}
              onChange={(e) => setField("color", e.target.value)}
              className="block h-12 w-20 cursor-pointer rounded-md border border-input p-1"
              {...invalidFieldProps("group-color", errors.color)}
            />
            <FieldError fieldId="group-color" message={errors.color} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-xl font-bold text-foreground">Weekly calls</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="weekly-zoom-url" className="text-base">Video call link</Label>
              <Input
                id="weekly-zoom-url"
                type="url"
                placeholder="https://…"
                value={draft.videoCallUrl}
                onChange={(e) => setField("videoCallUrl", e.target.value)}
                className="text-base"
                {...invalidFieldProps("weekly-zoom-url", errors.videoCallUrl)}
              />
              <FieldError fieldId="weekly-zoom-url" message={errors.videoCallUrl} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="zoom-meeting-time" className="text-base">Video call time</Label>
              <Input
                id="zoom-meeting-time"
                placeholder="Thursdays at 7pm"
                value={draft.videoCallTime}
                onChange={(e) => setField("videoCallTime", e.target.value)}
                className="text-base"
              />
            </div>
          </div>
          <p className="text-base text-muted-foreground">
            The prayer call is set up on the{" "}
            <Link
              href={groupPath(groupId, "/prayer")}
              className="inline-flex min-h-11 items-center font-semibold text-brand-primary-text underline underline-offset-4 hover:text-foreground"
            >
              Prayer page
            </Link>
            .
          </p>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <p aria-live="polite" className="min-h-6 text-base text-muted-foreground">
          {dirty ? "You have unsaved changes." : ""}
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button type="submit" size="lg" disabled={saving || !dirty}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
          <Button size="lg" variant="outline" nativeButton={false} render={<Link href={cancelHref} />}>
            Cancel
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={leaveGuard.asking}
        onOpenChange={(open) => !open && leaveGuard.stay()}
        title="Leave without saving?"
        description="Your changes to this page will be lost."
        confirmLabel="Leave without saving"
        cancelLabel="Keep editing"
        onConfirm={async () => leaveGuard.leave()}
      />
    </form>
  );
}
