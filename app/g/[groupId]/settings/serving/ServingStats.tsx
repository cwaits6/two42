"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarCheck, HandHelping } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { EmptyState } from "@/components/states/EmptyState";
import { ErrorState } from "@/components/states/ErrorState";
import { LoadingState } from "@/components/states/LoadingState";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { statsRange, type StatsRange } from "@/lib/serving/dates";
import { personName } from "@/lib/serving/display";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Team {
  team_id: string;
  name: string;
}

interface MemberRow {
  profileId: string;
  name: string;
  counts: Record<string, number>; // team_id → count
  total: number;
}

// ── Date range helpers ────────────────────────────────────────────────────────

const RANGES: { label: string; value: StatsRange }[] = [
  { label: "This year", value: "thisYear" },
  { label: "Last year", value: "lastYear" },
  { label: "Last 6 months", value: "6mo" },
  { label: "All time", value: "all" },
];

// ── Stats ────────────────────────────────────────────────────────────────────

export function ServingStats({
  groupId,
  today,
  teamsHref,
}: {
  groupId: string;
  /** Today in the church's time zone, "YYYY-MM-DD" */
  today: string;
  teamsHref: string;
}) {
  const [range, setRange] = useState<StatsRange>("thisYear");
  const [teams, setTeams] = useState<Team[]>([]);
  const [rows, setRows] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const supabase = createClient();

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setFailed(false);

      // Teams in this group with signups on
      const { data: teamSettings, error: teamsError } = await supabase
        .from("serving_team_settings")
        .select("team_id, teams!inner(name, group_id)")
        .eq("enabled", true)
        .eq("teams.group_id", groupId);

      const resolvedTeams: Team[] = (teamSettings ?? []).map((ts) => {
        const mg = ts.teams as unknown as { name: string } | null;
        return { team_id: ts.team_id as string, name: mg?.name ?? "Unknown team" };
      });

      if (cancelled) return;
      if (teamsError) {
        console.error("Failed to load serving teams: code=%s", teamsError.code);
        setFailed(true);
        setLoading(false);
        return;
      }
      setTeams(resolvedTeams);

      if (!resolvedTeams.length) {
        setRows([]);
        setLoading(false);
        return;
      }

      // Signups with attendees, filtered by date range
      const { start, end } = statsRange(range, today);
      const teamIds = resolvedTeams.map((t) => t.team_id);

      let query = supabase
        .from("serving_signups")
        .select(
          "id, service_date, team_id, serving_signup_attendees(profile_id, profiles(id, email, first_name, last_name, preferred_name))"
        )
        .in("team_id", teamIds)
        .order("service_date", { ascending: false });

      if (start) query = query.gte("service_date", start);
      if (end) query = query.lte("service_date", end);

      const { data: signups, error: signupsError } = await query;
      if (cancelled) return;
      if (signupsError) {
        console.error("Failed to load serving history: code=%s", signupsError.code);
        setFailed(true);
        setLoading(false);
        return;
      }

      // Aggregate: profileId → teamId → count
      const countMap = new Map<string, Map<string, number>>();
      const nameMap = new Map<string, string>();

      for (const signup of signups ?? []) {
        const teamId = signup.team_id as string;
        const attendees = (signup.serving_signup_attendees ?? []) as unknown as Array<{
          profile_id: string;
          profiles: {
            id: string;
            email: string | null;
            first_name: string | null;
            last_name: string | null;
            preferred_name: string | null;
          } | null;
        }>;

        for (const a of attendees) {
          if (!a.profiles) continue;
          const pid = a.profile_id;
          if (!nameMap.has(pid)) {
            nameMap.set(pid, personName(a.profiles));
          }
          if (!countMap.has(pid)) countMap.set(pid, new Map());
          const tc = countMap.get(pid)!;
          tc.set(teamId, (tc.get(teamId) ?? 0) + 1);
        }
      }

      const memberRows: MemberRow[] = Array.from(countMap.entries())
        .map(([profileId, tc]) => {
          const counts: Record<string, number> = {};
          let total = 0;
          for (const [tid, n] of tc) {
            counts[tid] = n;
            total += n;
          }
          return { profileId, name: nameMap.get(profileId)!, counts, total };
        })
        .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

      if (!cancelled) {
        setRows(memberRows);
        setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [range, groupId, today, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalServings = useMemo(
    () => rows.reduce((s, r) => s + r.total, 0),
    [rows]
  );

  return (
    <section>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold text-brand-primary-text">Who has served</h2>
          <p className="text-base text-muted-foreground mt-1">
            How often each member has served on each team with signups on.
          </p>
        </div>

        <Segmented
          label="Date range"
          options={RANGES}
          value={range}
          onChange={setRange}
        />
      </div>

      {loading ? (
        <LoadingState thing="serving history" />
      ) : failed ? (
        <ErrorState thing="serving history" onRetry={retry} />
      ) : teams.length === 0 ? (
        <EmptyState
          icon={HandHelping}
          message="No teams have signups on yet."
          action={
            <Button nativeButton={false} render={<Link href={teamsHref} />}>
              Go to Teams
            </Button>
          }
        />
      ) : rows.length === 0 ? (
        <EmptyState icon={CalendarCheck} message="No one has served in this period." />
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">
              {totalServings} {totalServings === 1 ? "turn" : "turns"} served by{" "}
              {rows.length} {rows.length === 1 ? "member" : "members"}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-base">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th className="text-left px-6 py-3 font-semibold text-muted-foreground">
                      Member
                    </th>
                    {teams.map((t) => (
                      <th
                        key={t.team_id}
                        className="text-right px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap"
                      >
                        {t.name}
                      </th>
                    ))}
                    <th className="text-right px-6 py-3 font-semibold text-brand-primary-text">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr
                      key={row.profileId}
                      className={`border-b border-border last:border-0 ${
                        i % 2 === 0 ? "" : "bg-muted/20"
                      }`}
                    >
                      <td className="px-6 py-3 font-medium text-foreground">
                        {row.name}
                      </td>
                      {teams.map((t) => (
                        <td
                          key={t.team_id}
                          className="px-4 py-3 text-right tabular-nums text-muted-foreground"
                        >
                          {row.counts[t.team_id] ?? "—"}
                        </td>
                      ))}
                      <td className="px-6 py-3 text-right tabular-nums font-bold text-brand-primary-text">
                        {row.total}
                      </td>
                    </tr>
                  ))}
                </tbody>
                {/* Footer totals row */}
                <tfoot>
                  <tr className="border-t-2 border-border bg-muted/40">
                    <td className="px-6 py-3 font-semibold text-muted-foreground">
                      Total
                    </td>
                    {teams.map((t) => {
                      const teamTotal = rows.reduce(
                        (s, r) => s + (r.counts[t.team_id] ?? 0),
                        0
                      );
                      return (
                        <td
                          key={t.team_id}
                          className="px-4 py-3 text-right tabular-nums font-semibold text-muted-foreground"
                        >
                          {teamTotal || "—"}
                        </td>
                      );
                    })}
                    <td className="px-6 py-3 text-right tabular-nums font-bold text-brand-primary-text">
                      {totalServings}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </section>
  );
}
