"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export interface PlatformDomainEvent {
  id: string;
  org_id: string;
  domain: string;
  event: string;
  detail: string | null;
  created_at: string;
  organizations: { name: string; slug: string } | null;
}

interface EventsListProps {
  initialEvents: PlatformDomainEvent[];
}

/** What the operator is being asked to do about the event, and how it is labelled. */
export function eventState(event: string): {
  label: string;
  variant: "default" | "secondary" | "destructive" | "outline";
  action: string;
} {
  if (event === "attach_permanent_failure") {
    return {
      label: "Attach failed",
      variant: "destructive",
      action:
        "Vercel refused this domain permanently. The worker will not retry it until this event is acknowledged; fix the cause first (the name is on another Vercel project or account, or the token or plan does not allow it).",
    };
  }
  if (event === "detached") {
    return {
      label: "Detached",
      variant: "outline",
      action:
        "The name has been removed from the Vercel project and its row deleted. Remove its redirect-allowlist entry in the Supabase dashboard, then acknowledge.",
    };
  }
  return { label: event, variant: "secondary", action: "" };
}

// Locale and time zone are explicit: a bare toLocaleString() renders in the
// server's zone during SSR and the browser's on hydration, which React
// reports as a mismatch.
function formatTime(value: string): string {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
}

export function EventsList({ initialEvents }: EventsListProps) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function handleAcknowledge(row: PlatformDomainEvent) {
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/platform/domain-events/${row.id}/acknowledge`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error || "Failed to acknowledge the event.");
        return;
      }
      if (data?.acknowledged) toast.success(data.message);
      else toast.info(data?.message || "Already acknowledged.");
      router.refresh();
    } catch (err) {
      console.error(err);
      toast.error("Network error. Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  const failures = initialEvents.filter((e) => e.event === "attach_permanent_failure");
  const detached = initialEvents.filter((e) => e.event === "detached");

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Worker events</h2>
        <p className="text-base text-muted-foreground">
          {failures.length} permanent attach {failures.length === 1 ? "failure" : "failures"},{" "}
          {detached.length} detached {detached.length === 1 ? "domain" : "domains"} awaiting
          allowlist removal. Each stays here until acknowledged.
        </p>
      </section>

      {initialEvents.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-base text-muted-foreground">No unacknowledged events.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {initialEvents.map((row) => {
            const state = eventState(row.event);
            return (
              <Card key={row.id}>
                <CardContent className="pt-6">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-xl font-semibold break-all">{row.domain}</p>
                        <Badge variant={state.variant}>{state.label}</Badge>
                      </div>
                      <p className="text-base text-muted-foreground">
                        {row.organizations?.name ?? "Unknown organization"}
                        {row.organizations?.slug ? ` (${row.organizations.slug})` : ""}
                      </p>
                      <p className="mt-2 text-sm text-muted-foreground">Recorded: {formatTime(row.created_at)}</p>
                      {row.detail && <p className="mt-2 text-sm break-words">{row.detail}</p>}
                      <p className="mt-2 text-sm text-muted-foreground">{state.action}</p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button
                        size="lg"
                        variant="outline"
                        className="text-lg"
                        onClick={() => handleAcknowledge(row)}
                        disabled={busyId === row.id}
                      >
                        {busyId === row.id ? "Acknowledging..." : "Acknowledge"}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
