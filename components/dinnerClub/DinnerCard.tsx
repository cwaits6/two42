"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AddToCalendarButton } from "@/components/events/AddToCalendarButton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { DINNER_HOURS } from "@/lib/dinnerClub/ics";
import { dinnerWhen } from "@/lib/dinnerClub/labels";
import { failureMessage } from "@/lib/errorCopy";
import { createClient } from "@/lib/supabase/client";
import { MoveDinnerButton } from "./MoveDinnerButton";

type Reply = "going" | "not_going";

export interface DinnerCardProps {
  dinnerId: string;
  startsAt: string;
  zone: string;
  seasonTitle: string;
  heading: string;
  hostNames: string | null;
  address: string | null;
  /** Everyone seated at the table. */
  atTable: { id: string; name: string }[];
  replies: Record<string, Reply>;
  /** The person and their partner, who each answer for themselves or each other. */
  mine: { id: string; name: string }[];
  /** The dinner has not started and the season is running. */
  open: boolean;
  isHost: boolean;
  canMove: boolean;
  /** For the host: the food needs of the parties with someone going. */
  foodNotes: { names: string; notes: string }[];
}

const REPLY_OPTIONS = [
  { value: "going" as const, label: "Going" },
  { value: "not_going" as const, label: "Not going" },
];

export function DinnerCard(props: DinnerCardProps) {
  const router = useRouter();
  const [replies, setReplies] = useState(props.replies);
  const [saving, setSaving] = useState(false);
  const going = props.atTable.filter((p) => replies[p.id] === "going");
  const notGoing = props.atTable.filter((p) => replies[p.id] === "not_going");
  const noReply = props.atTable.length - going.length - notGoing.length;

  async function reply(profileId: string, status: Reply) {
    setSaving(true);
    const before = replies;
    setReplies((r) => ({ ...r, [profileId]: status }));
    const { data, error } = await createClient()
      .from("dinner_replies")
      .upsert({ dinner_id: props.dinnerId, profile_id: profileId, status }, { onConflict: "dinner_id,profile_id" })
      .select("dinner_id");
    setSaving(false);
    if (error || !data?.length) {
      setReplies(before);
      toast.error(failureMessage("save the reply"));
      return;
    }
    router.refresh();
  }

  const end = new Date(new Date(props.startsAt).getTime() + DINNER_HOURS * 3_600_000).toISOString();

  return (
    <Card>
      <CardHeader>
        <p className="text-base font-semibold uppercase tracking-widest text-muted-foreground">{props.heading}</p>
        <CardTitle className="text-2xl font-bold">{dinnerWhen(props.startsAt, props.zone)}</CardTitle>
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
        </dl>

        {props.open &&
          props.mine.map((person, index) => (
            <div key={person.id} className="space-y-2">
              <p className="text-lg font-medium">{index === 0 ? "Your reply" : `${person.name}'s reply`}</p>
              <Segmented
                label={index === 0 ? "Your reply" : `${person.name}'s reply`}
                options={REPLY_OPTIONS}
                value={replies[person.id] ?? ("" as Reply)}
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

        {props.open && (
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            {props.canMove && <MoveDinnerButton dinnerId={props.dinnerId} startsAt={props.startsAt} zone={props.zone} />}
            <AddToCalendarButton
              eventTitle={`${props.seasonTitle}: dinner`}
              startTime={props.startsAt}
              endTime={end}
              location={props.address}
              timeZone={props.zone}
              instance={props.dinnerId}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
