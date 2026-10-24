"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
} from "@/components/ui/combobox";
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
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import { displayName } from "@/lib/names";
import {
  GROUP_DESCRIPTION_MAX,
  GROUP_NAME_MAX,
  groupCreationErrorMessage,
  validateGroupDescription,
  validateGroupName,
} from "@/lib/groups/creation";

export interface CreatedGroup {
  id: string;
  /** False when an org admin named someone else as leader: the viewer is not in the group. */
  viewerIsLeader: boolean;
}

export interface RequestedGroup {
  id: string;
  name: string;
}

interface LeaderOption {
  id: string;
  name: string;
}

interface CreateGroupDialogProps {
  /** create calls group_create(); request files a group_requests row. */
  mode: "create" | "request";
  /** Shows the Leader field; the database refuses it for anyone else. */
  isOrgAdmin: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (group: CreatedGroup) => void;
  onRequested: (request: RequestedGroup) => void;
}

export function CreateGroupDialog({
  mode,
  isOrgAdmin,
  open,
  onOpenChange,
  onCreated,
  onRequested,
}: CreateGroupDialogProps) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [leaderId, setLeaderId] = useState<string | null>(null);
  const [leaders, setLeaders] = useState<LeaderOption[]>([]);
  const [saving, setSaving] = useState(false);

  // The admin arm of the profiles SELECT policy returns the whole org; a
  // member never sees this field, so nothing is loaded for them.
  useEffect(() => {
    if (!open || !isOrgAdmin) return;
    let cancelled = false;
    (async () => {
      const [
        {
          data: { user },
        },
        { data, error },
      ] = await Promise.all([
        supabase.auth.getUser(),
        supabase
          .from("profiles")
          .select("id, first_name, last_name, preferred_name")
          .neq("role", "pending")
          .order("last_name", { ascending: true })
          .order("first_name", { ascending: true }),
      ]);
      if (cancelled) return;
      if (error) {
        console.error(error);
        toast.error("Couldn't load the member list.");
        return;
      }
      setViewerId(user?.id ?? null);
      setLeaderId((current) => current ?? user?.id ?? null);
      setLeaders((data ?? []).map((p) => ({ id: p.id, name: displayName(p) })));
    })();
    return () => {
      cancelled = true;
    };
  }, [open, isOrgAdmin, supabase]);

  const leaderIds = useMemo(() => leaders.map((l) => l.id), [leaders]);
  const leaderLabel = (id: string | null) => leaders.find((l) => l.id === id)?.name ?? "";
  const leadsSomeoneElse = isOrgAdmin && leaderId !== null && viewerId !== null && leaderId !== viewerId;

  function reset() {
    setName("");
    setDescription("");
    setLeaderId(null);
  }

  function close() {
    onOpenChange(false);
    reset();
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const checkedName = validateGroupName(name);
    if (!checkedName.ok) {
      toast.error(checkedName.reason);
      return;
    }
    const checkedDescription = validateGroupDescription(description);
    if (!checkedDescription.ok) {
      toast.error(checkedDescription.reason);
      return;
    }

    setSaving(true);
    try {
      if (mode === "create") {
        const { data, error } = await supabase.rpc("group_create", {
          _name: checkedName.value,
          _description: checkedDescription.value ?? undefined,
          _leader_id: isOrgAdmin && leaderId ? leaderId : undefined,
        });
        if (error || !data) {
          toast.error(groupCreationErrorMessage(error?.code));
          return;
        }
        toast.success("Group created.");
        onCreated({ id: data, viewerIsLeader: !leadsSomeoneElse });
      } else {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          toast.error("Session expired. Please log in again.");
          return;
        }
        const { data, error } = await supabase
          .from("group_requests")
          .insert({
            requested_by: user.id,
            name: checkedName.value,
            description: checkedDescription.value,
          })
          .select("id, name");
        if (error?.code === "42501") {
          toast.error("Your organization no longer takes group requests.");
          router.refresh();
          close();
          return;
        }
        if (error?.code === "23505") {
          toast.error("You already asked for a group with this name.");
          return;
        }
        if (error || !data?.length) {
          toast.error("Couldn't send the request. Please try again.");
          return;
        }
        toast.success("Request sent. An org admin will review it.");
        onRequested(data[0]);
      }
      close();
    } finally {
      setSaving(false);
    }
  }

  const creating = mode === "create";

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent>
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle className="text-2xl">
              {creating ? "Create a group" : "Request a group"}
            </DialogTitle>
            <DialogDescription>
              {creating
                ? "The group starts with its leader and an empty roster."
                : "An org admin reviews the request. The group opens once it is approved."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">
            <div className="space-y-2">
              <Label htmlFor="create-group-name" className="text-base">
                Group name
              </Label>
              <Input
                id="create-group-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Men's Breakfast"
                maxLength={GROUP_NAME_MAX}
                required
                autoFocus
                className="h-12 text-base"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-group-meeting" className="text-base">
                Meeting time and place
              </Label>
              <Textarea
                id="create-group-meeting"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Saturdays, 8:00 am · Fellowship Hall"
                rows={2}
                maxLength={GROUP_DESCRIPTION_MAX}
                className="text-base"
              />
            </div>
            {isOrgAdmin && creating && (
              <div className="space-y-2">
                <Label htmlFor="create-group-leader" className="text-base">
                  Leader
                </Label>
                <Combobox
                  items={leaderIds}
                  itemToStringLabel={leaderLabel}
                  value={leaderId}
                  onValueChange={(v) => {
                    if (v) setLeaderId(v);
                  }}
                >
                  <ComboboxInput
                    id="create-group-leader"
                    placeholder="Search members…"
                    className="h-12 px-3 text-base"
                  />
                  <ComboboxPopup>
                    <ComboboxEmpty className="text-base" />
                    <ComboboxList>
                      {(id: string) => (
                        <ComboboxItem key={id} value={id} className="min-h-11">
                          {leaderLabel(id)}
                        </ComboboxItem>
                      )}
                    </ComboboxList>
                  </ComboboxPopup>
                </Combobox>
                <p className="text-base text-muted-foreground">
                  If you choose someone else, you will not be a member of the group.
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" size="lg" onClick={close} disabled={saving}>
              Cancel
            </Button>
            <Button
              type="submit"
              size="lg"
              disabled={saving}
              className="bg-brand-primary text-white hover:bg-brand-primary/90"
            >
              {saving ? "Saving…" : creating ? "Create group" : "Send request"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
