"use client";

import { useMemo, useState } from "react";
import { HandHeart, Search, SearchX, X } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { failureMessage } from "@/lib/errorCopy";
import { prayerAuthorLabel } from "@/lib/prayer";
import { PrayerCard } from "@/components/prayer/PrayerCard";
import { PrayerComposer } from "@/components/prayer/PrayerComposer";
import { PrayerCallCard, type PrayerCall } from "@/components/prayer/PrayerCallCard";
import { EmptyState } from "@/components/states/EmptyState";
import { ErrorState } from "@/components/states/ErrorState";
import { Segmented } from "@/components/ui/segmented";
import type { MemberOption } from "@/components/giving/FundForm";
import type { PrayerWallRow } from "@/lib/types";

export interface Me {
  id: string;
  name: string;
  initials: string;
  avatarUrl: string | null;
}

const STATUS_FILTERS = ["All", "My requests", "Answered"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];
const STATUS_OPTIONS = STATUS_FILTERS.map((f) => ({ value: f, label: f }));

export type PrayerGroup = { id: string; name: string; isLeader: boolean };

export function PrayerBoard({
  initialRequests,
  prayerCall,
  me,
  group,
  members,
  orgId,
  timeZone,
}: {
  initialRequests: PrayerWallRow[];
  /** The call's times and standing details; null when they couldn't be loaded. */
  prayerCall: PrayerCall | null;
  me: Me;
  /** The verified active group; every write names it. */
  group: PrayerGroup;
  members: MemberOption[];
  /** Resolved server-side from the caller's own profile; scopes the session writes. */
  orgId: string;
  /** The church's zone; the call times are its wall clock. */
  timeZone: string;
}) {
  const [requests, setRequests] = useState(initialRequests);
  const [status, setStatus] = useState<StatusFilter>("All");
  const [query, setQuery] = useState("");
  const [prayPending, setPrayPending] = useState<Set<string>>(new Set());

  const handlePost = async (draft: { body: string; is_anonymous: boolean }) => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("prayer_requests")
      .insert({ author_id: me.id, group_id: group.id, ...draft })
      .select("id, created_at")
      .single();
    if (error || !data) {
      toast.error(failureMessage("post your request"));
      return false;
    }
    setRequests((prev) => [
      {
        id: data.id,
        group_id: group.id,
        body: draft.body,
        is_anonymous: draft.is_anonymous,
        is_answered: false,
        created_at: data.created_at,
        mine: true,
        first_name: null,
        last_name: null,
        preferred_name: me.name,
        avatar_url: me.avatarUrl,
        praying_count: 0,
        i_am_praying: false,
      },
      ...prev,
    ]);
    return true;
  };

  const patchRequest = (id: string, patch: Partial<PrayerWallRow>) =>
    setRequests((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...patch } : r))
    );

  // One write per request at a time — a double-click would otherwise reuse
  // stale row data and let the count drift from the database.
  const handlePray = async (row: PrayerWallRow) => {
    if (prayPending.has(row.id)) return;
    setPrayPending((prev) => new Set(prev).add(row.id));
    const supabase = createClient();
    const praying = !row.i_am_praying;
    patchRequest(row.id, {
      i_am_praying: praying,
      praying_count: row.praying_count + (praying ? 1 : -1),
    });
    const { error } = praying
      ? await supabase
          .from("prayer_responses")
          .insert({ request_id: row.id, profile_id: me.id, group_id: group.id })
      : await supabase
          .from("prayer_responses")
          .delete()
          .eq("request_id", row.id)
          .eq("group_id", group.id)
          .eq("profile_id", me.id);
    if (error) {
      patchRequest(row.id, {
        i_am_praying: row.i_am_praying,
        praying_count: row.praying_count,
      });
      toast.error(failureMessage("save that"));
    }
    setPrayPending((prev) => {
      const next = new Set(prev);
      next.delete(row.id);
      return next;
    });
  };

  const handleToggleAnswered = async (row: PrayerWallRow) => {
    const supabase = createClient();
    const answered = !row.is_answered;
    patchRequest(row.id, { is_answered: answered });
    const { data, error } = await supabase
      .from("prayer_requests")
      .update({ is_answered: answered })
      .eq("id", row.id)
      .eq("group_id", group.id)
      .select("id");
    if (error || !data?.length) {
      patchRequest(row.id, { is_answered: row.is_answered });
      toast.error(failureMessage("save that"));
    }
  };

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return requests.filter((r) => {
      if (status === "My requests" && !r.mine) return false;
      if (status === "Answered" && !r.is_answered) return false;
      if (!q) return true;
      return (
        r.body.toLowerCase().includes(q) ||
        prayerAuthorLabel(r).toLowerCase().includes(q)
      );
    });
  }, [requests, status, query]);

  const wall = (
    <div>
      <div className="flex min-h-12 items-center gap-2.5 rounded-full border border-input bg-card pl-4 pr-1">
        <Search className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search requests…"
          aria-label="Search requests"
          className="min-h-11 w-full bg-transparent text-base outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
        />
        {query && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => setQuery("")}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <Segmented label="Show requests" options={STATUS_OPTIONS} value={status} onChange={setStatus} />
        <span className="text-base text-muted-foreground" aria-live="polite">
          {shown.length} shown
        </span>
      </div>

      {shown.length > 0 ? (
        <div className="mt-4 space-y-3">
          {shown.map((r) => (
            <PrayerCard
              key={r.id}
              row={r}
              prayPending={prayPending.has(r.id)}
              onPray={() => handlePray(r)}
              onToggleAnswered={() => handleToggleAnswered(r)}
              timeZone={timeZone}
            />
          ))}
        </div>
      ) : requests.length === 0 ? (
        <EmptyState className="mt-4" icon={HandHeart} message="No prayer requests yet." />
      ) : (
        <EmptyState className="mt-4" icon={SearchX} message="No requests to show." />
      )}
    </div>
  );

  return (
    <div className="grid gap-8 lg:grid-cols-[1.55fr_1fr] lg:items-start">
      <div className="order-2 lg:order-1">{wall}</div>
      <div className="order-1 space-y-6 lg:sticky lg:top-6 lg:order-2">
        <PrayerComposer me={me} groupName={group.name} onPost={handlePost} />
        {prayerCall ? (
          <PrayerCallCard
            initial={prayerCall}
            group={group}
            members={members}
            orgId={orgId}
            userId={me.id}
            timeZone={timeZone}
          />
        ) : (
          <ErrorState thing="the prayer call" />
        )}
      </div>
    </div>
  );
}
