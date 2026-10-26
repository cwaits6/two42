"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { prayerAuthorLabel } from "@/lib/prayer";
import { PrayerCard } from "@/components/prayer/PrayerCard";
import { PrayerComposer } from "@/components/prayer/PrayerComposer";
import { PrayerCallCard } from "@/components/prayer/PrayerCallCard";
import type { MemberOption } from "@/components/giving/FundForm";
import type { PrayerCallSession, PrayerWallRow } from "@/lib/types";

export interface Me {
  id: string;
  name: string;
  initials: string;
  avatarUrl: string | null;
}

const STATUS_FILTERS = ["All", "My requests", "Answered"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

export type PrayerGroup = { id: string; name: string; isLeader: boolean };

export function PrayerBoard({
  initialRequests,
  sessions,
  me,
  group,
  members,
  orgId,
  prayerCall,
}: {
  initialRequests: PrayerWallRow[];
  sessions: PrayerCallSession[];
  me: Me;
  /** The verified active group; every write names it. */
  group: PrayerGroup;
  members: MemberOption[];
  /** Resolved server-side from the caller's own profile; scopes the session writes. */
  orgId: string;
  prayerCall: { url: string | null; time: string | null };
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
      toast.error("Couldn't post your request. Please try again.");
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
      toast.error("Couldn't save that. Please try again.");
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
      toast.error("Couldn't save that. Please try again.");
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
      {/* Search */}
      <div className="flex items-center gap-2.5 rounded-full border border-border bg-card px-4 py-2.5">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search requests…"
          aria-label="Search requests"
          className="w-full bg-transparent text-base outline-none placeholder:text-muted-foreground"
        />
        {query && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => setQuery("")}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Status filters */}
      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        {STATUS_FILTERS.map((f) => {
          const active = f === status;
          return (
            <button
              key={f}
              type="button"
              onClick={() => setStatus(f)}
              className={`rounded-full border px-4 py-3 text-base transition-colors ${
                active
                  ? "border-foreground bg-foreground font-semibold text-background"
                  : "border-border bg-card font-medium text-muted-foreground hover:text-foreground"
              }`}
            >
              {f}
            </button>
          );
        })}
        <span className="ml-auto text-sm text-muted-foreground">
          {shown.length} shown
        </span>
      </div>

      {/* Wall */}
      {shown.length > 0 ? (
        <div className="mt-4 space-y-3">
          {shown.map((r) => (
            <PrayerCard
              key={r.id}
              row={r}
              prayPending={prayPending.has(r.id)}
              onPray={() => handlePray(r)}
              onToggleAnswered={() => handleToggleAnswered(r)}
            />
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-2xl border border-dashed border-border bg-card px-6 py-12 text-center text-muted-foreground">
          {requests.length === 0
            ? "No requests yet. Share the first one."
            : "No requests match your filters."}
        </div>
      )}
    </div>
  );

  return (
    <div className="grid gap-8 lg:grid-cols-[1.55fr_1fr] lg:items-start">
      <div className="order-2 lg:order-1">{wall}</div>
      <div className="order-1 space-y-6 lg:sticky lg:top-6 lg:order-2">
        <PrayerComposer me={me} groupName={group.name} onPost={handlePost} />
        <PrayerCallCard
          initialSessions={sessions}
          group={group}
          members={members}
          orgId={orgId}
          prayerCall={prayerCall}
        />
      </div>
    </div>
  );
}
