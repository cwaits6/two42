"use client";

import { useState, type ReactNode } from "react";
import { Inbox } from "lucide-react";
import { PendingAccessRequests, type PendingAccessRequest } from "@/components/admin/PendingAccessRequests";
import { PendingGroupRequests } from "@/components/admin/PendingGroupRequests";
import { PendingJoinRequests } from "@/components/admin/PendingJoinRequests";
import { EmptyState } from "@/components/states/EmptyState";
import { ErrorState } from "@/components/states/ErrorState";
import { requestsWaiting, totalWaiting } from "@/lib/admin/requestsWaiting";
import type { PendingJoinRequest } from "@/lib/groups/joinQueue";
import type { PendingGroupRequest } from "@/lib/groups/requests";

interface RequestsBoardProps {
  /** Each kind is null when it could not be read, so the others still show. */
  access: PendingAccessRequest[] | null;
  group: PendingGroupRequest[] | null;
  join: PendingJoinRequest[] | null;
  /** The church's count of requests waiting, as the menu reads it; null when it could not be counted. */
  waiting: number | null;
  timeZone: string;
}

/** Every request waiting on a church admin. A kind shows only while it has something waiting. */
export function RequestsBoard({ access, group, join, waiting, timeZone }: RequestsBoardProps) {
  // What was decided here since the server read. Kept apart from the lists so
  // a re-read after "Try again" still reaches the page.
  const [decided, setDecided] = useState<ReadonlySet<string>>(new Set());
  const remove = (id: string) => setDecided((ids) => new Set(ids).add(id));
  const undecided = <T extends { id: string }>(rows: T[] | null) =>
    rows && rows.filter((row) => !decided.has(row.id));

  const accessRows = undecided(access);
  const groupRows = undecided(group);
  const joinRows = undecided(join);

  const kinds: { key: string; title: string; about: string; thing: string; count: number | null; queue: ReactNode }[] = [
    {
      key: "access",
      title: "Access requests",
      about: "People asking to join the church.",
      thing: "the access requests",
      count: accessRows?.length ?? null,
      queue: accessRows && <PendingAccessRequests requests={accessRows} onRemove={remove} timeZone={timeZone} />,
    },
    {
      key: "group",
      title: "Group requests",
      about: "Members asking to start a group.",
      thing: "the group requests",
      count: groupRows?.length ?? null,
      queue: groupRows && <PendingGroupRequests requests={groupRows} onRemove={remove} timeZone={timeZone} />,
    },
    {
      key: "join",
      title: "Join requests",
      about: "People asking to join a group.",
      thing: "the join requests",
      count: joinRows?.length ?? null,
      queue: joinRows && <PendingJoinRequests requests={joinRows} onRemove={remove} timeZone={timeZone} />,
    },
  ];

  const listed = totalWaiting({
    access: kinds[0].count,
    group: kinds[1].count,
    join: kinds[2].count,
  });
  if (listed === 0) return <EmptyState icon={Inbox} message={requestsWaiting(0)} />;

  // A decided row leaves the count only while the lists still hold it: once the
  // page re-reads, the count has dropped it too.
  const read = totalWaiting({
    access: access?.length ?? null,
    group: group?.length ?? null,
    join: join?.length ?? null,
  });
  const total = read === null || listed === null || waiting === null ? null : waiting - (read - listed);

  const shown = kinds.filter((kind) => kind.count !== 0);
  return (
    <div className="space-y-10">
      {total !== null && total > 0 && (
        <p role="status" className="text-lg text-muted-foreground">
          {requestsWaiting(total)}
        </p>
      )}
      {shown.map((kind) => (
        <section key={kind.key} aria-labelledby={`requests-${kind.key}`}>
          <h2 id={`requests-${kind.key}`} className="text-2xl font-bold text-brand-primary-text">
            {kind.title}
          </h2>
          <p className="mb-4 mt-1 text-base text-muted-foreground">{kind.about}</p>
          {kind.count === null ? <ErrorState thing={kind.thing} /> : kind.queue}
        </section>
      ))}
      {shown.length < kinds.length && shown.every((kind) => kind.count === null) && (
        <p className="text-lg text-muted-foreground">No other requests waiting.</p>
      )}
    </div>
  );
}
