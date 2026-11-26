"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AddToCalendarButton } from "@/components/events/AddToCalendarButton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { SUPPER_HOURS } from "@/lib/supperClub/ics";
import { supperWhen, REPLY_OPTIONS, type ReplyStatus } from "@/lib/supperClub/labels";
import { failureMessage } from "@/lib/errorCopy";
import { createClient } from "@/lib/supabase/client";
import { BringListDialog, type BringGuest } from "./BringListDialog";
import { MoveSupperButton } from "./MoveSupperButton";

export interface SupperCardProps {
  supperId: string;
  startsAt: string;
  zone: string;
  rotationTitle: string;
  heading: string;
  hostNames: string | null;
  address: string | null;
  /** Everyone seated at the table. */
  atTable: { id: string; name: string }[];
  replies: Record<string, ReplyStatus>;
  /** The person and their partner, who each answer for themselves or each other. */
  mine: { id: string; name: string }[];
  /** The supper has not started and the rotation is running. */
  open: boolean;
  isHost: boolean;
  canMove: boolean;
  /** For the host: the food needs of the parties with someone going. */
  foodNotes: { names: string; notes: string }[];
  /** What the person's party brings, when the rotation's hosts say. */
  bringing: string | null;
  /** The host said they can't host this supper. */
  hostUnavailable: boolean;
  /** For the host while the rotation's hosts say what guests bring. */
  bringList: {
    supper: { id: string; rotationId: string; groupId: string; tableId: string; label: string };
    guests: BringGuest[];
    earlier: Record<string, string[]>;
    supperIndex: number;
  } | null;
}

export function SupperCard(props: SupperCardProps) {
  const router = useRouter();
  const [replies, setReplies] = useState(props.replies);
  // A refresh brings everyone's latest replies; take them over what this card holds.
  const [fromServer, setFromServer] = useState(props.replies);
  if (props.replies !== fromServer) {
    setFromServer(props.replies);
    setReplies(props.replies);
  }
  const [saving, setSaving] = useState(false);
  const [cantHost, setCantHost] = useState(false);
  const going = props.atTable.filter((p) => replies[p.id] === "going");
  const notGoing = props.atTable.filter((p) => replies[p.id] === "not_going");
  const noReply = props.atTable.length - going.length - notGoing.length;

  async function reply(profileId: string, status: ReplyStatus) {
    setSaving(true);
    const before = replies;
    setReplies((r) => ({ ...r, [profileId]: status }));
    const { data, error } = await createClient()
      .from("supper_replies")
      .upsert({ supper_id: props.supperId, profile_id: profileId, status }, { onConflict: "supper_id,profile_id" })
      .select("supper_id");
    setSaving(false);
    if (error || !data?.length) {
      setReplies(before);
      toast.error(failureMessage("save the reply"));
      return;
    }
    router.refresh();
  }

  async function setHostUnavailable(value: boolean) {
    const { data, error } = await createClient()
      .from("suppers")
      .update({ host_unavailable: value })
      .eq("id", props.supperId)
      .select("id");
    if (error || !data?.length) {
      toast.error(failureMessage("save that"));
      return;
    }
    setCantHost(false);
    toast.success(value ? "The leader will sort out this supper." : "You're hosting this supper.");
    router.refresh();
  }

  const end = new Date(new Date(props.startsAt).getTime() + SUPPER_HOURS * 3_600_000).toISOString();

  return (
    <Card>
      <CardHeader>
        <p className="text-base font-semibold uppercase tracking-widest text-muted-foreground">{props.heading}</p>
        <CardTitle className="text-2xl font-bold">{supperWhen(props.startsAt, props.zone)}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <dl className="space-y-3 text-lg">
          <div>
            <dt className="text-base text-muted-foreground">Host</dt>
            <dd>{props.isHost ? "You" : (props.hostNames ?? "Not chosen yet")}</dd>
          </div>
          {props.address && (
            <div>
              <dt className="text-base text-muted-foreground">Address</dt>
              <dd>{props.address}</dd>
            </div>
          )}
          <div>
            <dt className="text-base text-muted-foreground">At the table</dt>
            <dd>{props.atTable.map((p) => p.name).join(", ")}</dd>
          </div>
          {props.bringing && (
            <div>
              <dt className="text-base text-muted-foreground">You&apos;re bringing</dt>
              <dd className="font-semibold">{props.bringing}</dd>
            </div>
          )}
        </dl>

        {props.open &&
          props.mine.map((person, index) => (
            <div key={person.id} className="space-y-2">
              <p className="text-lg font-medium">{index === 0 ? "Your reply" : `${person.name}'s reply`}</p>
              <Segmented
                label={index === 0 ? "Your reply" : `${person.name}'s reply`}
                options={REPLY_OPTIONS}
                value={replies[person.id] ?? ("" as ReplyStatus)}
                onChange={(status) => !saving && reply(person.id, status)}
              />
            </div>
          ))}

        {props.isHost && (
          <div className="space-y-3 rounded-xl border border-border p-4">
            <p className="text-lg">
              <strong>{going.length} going</strong>
              {going.length > 0 ? `: ${going.map((p) => p.name).join(", ")}` : ""}
            </p>
            <p className="text-lg">
              {notGoing.length} not going · {noReply} no reply yet
            </p>
            {props.bringList?.guests.some((g) => g.item) && (
              <div className="space-y-1">
                <p className="text-lg font-medium">What guests bring</p>
                <ul className="space-y-1 text-lg">
                  {props.bringList.guests
                    .filter((g) => g.item)
                    .map((g) => (
                      <li key={g.partyId}>
                        {g.names}: {g.item}
                      </li>
                    ))}
                </ul>
              </div>
            )}
            {props.foodNotes.length > 0 && (
              <div className="space-y-1">
                <p className="text-lg font-medium">Food needs</p>
                <ul className="space-y-1 text-lg">
                  {props.foodNotes.map((n) => (
                    <li key={n.names}>
                      {n.names}: {n.notes}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {props.isHost && props.open && props.hostUnavailable && (
          <p role="status" className="rounded-xl border border-border bg-muted p-4 text-lg">
            You said you can&apos;t host this supper. The leader will sort it out.
          </p>
        )}

        {props.open && (
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            {props.canMove && <MoveSupperButton supperId={props.supperId} startsAt={props.startsAt} zone={props.zone} />}
            {props.bringList && <BringListDialog {...props.bringList} />}
            {props.isHost &&
              (props.hostUnavailable ? (
                <Button variant="outline" size="lg" onClick={() => setHostUnavailable(false)}>
                  I can host after all
                </Button>
              ) : (
                <Button variant="outline" size="lg" onClick={() => setCantHost(true)}>
                  Can&apos;t host this supper
                </Button>
              ))}
            <AddToCalendarButton
              eventTitle={`${props.rotationTitle}: supper`}
              startTime={props.startsAt}
              endTime={end}
              location={props.address}
              timeZone={props.zone}
              instance={props.supperId}
            />
          </div>
        )}
        <ConfirmDialog
          open={cantHost}
          onOpenChange={setCantHost}
          title="Can't host this supper?"
          description="The leader is told and finds another host, moves the supper or moves the guests. Your table hears once it's sorted."
          confirmLabel="Can't host"
          pendingLabel="Saving…"
          confirmVariant="default"
          onConfirm={() => setHostUnavailable(true)}
        />
      </CardContent>
    </Card>
  );
}
