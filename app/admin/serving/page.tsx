"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { displayName } from "@/lib/names";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Team {
  group_id: string;
  name: string;
}

interface MemberRow {
  profileId: string;
  name: string;
  counts: Record<string, number>; // group_id → count
  total: number;
}

// ── Date range helpers ────────────────────────────────────────────────────────

const RANGES = [
  { label: "This year", value: "thisYear" },
  { label: "Last year", value: "lastYear" },
  { label: "Last 6 months", value: "6mo" },
  { label: "All time", value: "all" },
] as const;

type RangeKey = (typeof RANGES)[number]["value"];

function dateRange(key: RangeKey): { start: string | null; end: string | null } {
  const now = new Date();
  const y = now.getFullYear();

  if (key === "thisYear") {
    return { start: `${y}-01-01`, end: `${y}-12-31` };
  }
  if (key === "lastYear") {
    return { start: `${y - 1}-01-01`, end: `${y - 1}-12-31` };
  }
  if (key === "6mo") {
    const d = new Date(now);
    d.setMonth(d.getMonth() - 6);
    return {
      start: d.toISOString().slice(0, 10),
      end: now.toISOString().slice(0, 10),
    };
  }
  return { start: null, end: null };
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ServingStatsPage() {
  const [range, setRange] = useState<RangeKey>("thisYear");
  const [teams, setTeams] = useState<Team[]>([]);
  const [rows, setRows] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);

      // Enabled teams
      const { data: teamSettings } = await supabase
        .from("serving_team_settings")
        .select("group_id, teams(name)")
        .eq("enabled", true);

      const resolvedTeams: Team[] = (teamSettings ?? []).map((ts) => {
        const mg = ts.teams as unknown as { name: string } | null;
        return { group_id: ts.group_id as string, name: mg?.name ?? "Unknown team" };
      });

      if (cancelled) return;
      setTeams(resolvedTeams);

      if (!resolvedTeams.length) {
        setRows([]);
        setLoading(false);
        return;
      }

      // Signups with attendees, filtered by date range
      const { start, end } = dateRange(range);
      const groupIds = resolvedTeams.map((t) => t.group_id);

      let query = supabase
        .from("serving_signups")
        .select(
          "id, service_date, group_id, serving_signup_attendees(profile_id, profiles(id, first_name, last_name, preferred_name))"
        )
        .in("group_id", groupIds)
        .order("service_date", { ascending: false });

      if (start) query = query.gte("service_date", start);
      if (end) query = query.lte("service_date", end);

      const { data: signups } = await query;
      if (cancelled) return;

      // Aggregate: profileId → groupId → count
      const countMap = new Map<string, Map<string, number>>();
      const nameMap = new Map<string, string>();

      for (const signup of signups ?? []) {
        const groupId = signup.group_id as string;
        const attendees = (signup.serving_signup_attendees ?? []) as unknown as Array<{
          profile_id: string;
          profiles: { id: string; first_name: string | null; last_name: string | null; preferred_name: string | null } | null;
        }>;

        for (const a of attendees) {
          if (!a.profiles) continue;
          const pid = a.profile_id;
          if (!nameMap.has(pid)) {
            nameMap.set(pid, displayName(a.profiles));
          }
          if (!countMap.has(pid)) countMap.set(pid, new Map());
          const gc = countMap.get(pid)!;
          gc.set(groupId, (gc.get(groupId) ?? 0) + 1);
        }
      }

      const memberRows: MemberRow[] = Array.from(countMap.entries())
        .map(([profileId, gc]) => {
          const counts: Record<string, number> = {};
          let total = 0;
          for (const [gid, n] of gc) {
            counts[gid] = n;
            total += n;
          }
          return { profileId, name: nameMap.get(profileId) ?? "Unknown", counts, total };
        })
        .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

      if (!cancelled) {
        setRows(memberRows);
        setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [range]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalServings = useMemo(
    () => rows.reduce((s, r) => s + r.total, 0),
    [rows]
  );

  return (
    <div className="container mx-auto px-4 py-12 max-w-4xl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-brand-primary">Serving Stats</h1>
          <p className="text-muted-foreground mt-1">
            Who has served, and how often, across all active teams.
          </p>
        </div>

        {/* Range filter */}
        <div className="flex gap-2 flex-wrap">
          {RANGES.map((r) => (
            <button
              key={r.value}
              type="button"
              onClick={() => setRange(r.value)}
              className={`px-4 py-3 rounded-lg text-base font-medium border transition-colors ${
                range === r.value
                  ? "bg-brand-primary text-white border-brand-primary"
                  : "border-border text-muted-foreground hover:border-brand-primary/50"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : teams.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            No serving teams are enabled yet. Enable a team from the Serving page.
          </CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            No serving data for this period.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">
              {totalServings} serving slot{totalServings !== 1 ? "s" : ""} logged
              {" · "}
              {rows.length} member{rows.length !== 1 ? "s" : ""}
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
                        key={t.group_id}
                        className="text-right px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap"
                      >
                        {t.name}
                      </th>
                    ))}
                    <th className="text-right px-6 py-3 font-semibold text-brand-primary">
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
                          key={t.group_id}
                          className="px-4 py-3 text-right tabular-nums text-muted-foreground"
                        >
                          {row.counts[t.group_id] ?? "—"}
                        </td>
                      ))}
                      <td className="px-6 py-3 text-right tabular-nums font-bold text-brand-primary">
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
                        (s, r) => s + (r.counts[t.group_id] ?? 0),
                        0
                      );
                      return (
                        <td
                          key={t.group_id}
                          className="px-4 py-3 text-right tabular-nums font-semibold text-muted-foreground"
                        >
                          {teamTotal || "—"}
                        </td>
                      );
                    })}
                    <td className="px-6 py-3 text-right tabular-nums font-bold text-brand-primary">
                      {totalServings}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
