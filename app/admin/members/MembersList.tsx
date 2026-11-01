"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Clock, Pencil, Search, UserPlus } from "lucide-react";
import type { AccessRequest, Profile, UserRole } from "@/lib/types";
import { failureMessage, NETWORK_ERROR } from "@/lib/errorCopy";
import { requestedOn } from "@/lib/groups/joinQueue";
import { displayName } from "@/lib/names";
import { toUserRole } from "@/lib/roles";
import { ApprovalQueue } from "@/components/admin/ApprovalQueue";
import { matchesSearch } from "@/components/admin/adminSearch";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/states/EmptyState";
import { ErrorState } from "@/components/states/ErrorState";
import { LoadingState } from "@/components/states/LoadingState";
import { ROLE_OPTIONS, roleChangeCopy, roleLockReason } from "./memberRoles";

// Raised by the profiles trigger when a change would leave the church with
// no church admin.
const LAST_CHURCH_ADMIN = "CA001";
const ALREADY_REVIEWED = "This request was already reviewed.";

interface RoleChange {
  member: Profile;
  role: UserRole;
}

export function MembersList({
  initialTab,
  timeZone,
}: {
  initialTab: "members" | "requests";
  timeZone: string;
}) {
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [members, setMembers] = useState<Profile[]>([]);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [query, setQuery] = useState("");
  const [busyRequestId, setBusyRequestId] = useState<string | null>(null);
  const [declining, setDeclining] = useState<AccessRequest | null>(null);
  const [roleChange, setRoleChange] = useState<RoleChange | null>(null);
  const loadedOnce = useRef(false);
  const supabase = useMemo(() => createClient(), []);

  const loadData = useCallback(async () => {
    const [
      { data: reqs, error: requestsError },
      { data: mems, error: membersError },
      { data: auth },
    ] = await Promise.all([
      supabase
        .from("access_requests")
        .select("*")
        .order("created_at", { ascending: false }),
      supabase
        .from("profiles")
        .select("*")
        .order("last_name", { ascending: true })
        .order("first_name", { ascending: true }),
      supabase.auth.getUser(),
    ]);
    if (requestsError || membersError) {
      console.error("Failed to load members:", requestsError ?? membersError);
      if (loadedOnce.current) toast.error(failureMessage("load the latest members"));
      else setStatus("failed");
      return;
    }
    loadedOnce.current = true;
    setViewerId(auth.user?.id ?? null);
    setRequests(reqs || []);
    setMembers((mems || []).map((m) => ({ ...m, role: toUserRole(m.role) })));
    setStatus("ready");
  }, [supabase]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function approve(request: AccessRequest) {
    setBusyRequestId(request.id);
    try {
      const res = await fetch("/api/admin/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: request.email, name: request.name }),
      });
      if (!res.ok) {
        toast.error(failureMessage("approve the request", res.status, { 404: ALREADY_REVIEWED }));
        if (res.status === 404) await loadData();
        return;
      }
      toast.success("Request approved.");
      await loadData();
    } catch {
      toast.error(NETWORK_ERROR);
    } finally {
      setBusyRequestId(null);
    }
  }

  async function decline(request: AccessRequest) {
    setBusyRequestId(request.id);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        toast.error(failureMessage("decline the request", 401));
        return;
      }
      // A write RLS rejects matches zero rows without an error, and so does a
      // decline that lost the race to another admin's review.
      const { data, error } = await supabase
        .from("access_requests")
        .update({
          status: "denied",
          reviewed_by: user.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", request.id)
        .eq("status", "pending")
        .select("id");
      if (error) {
        console.error(error);
        toast.error(failureMessage("decline the request"));
        return;
      }
      toast[data.length ? "success" : "error"](data.length ? "Request declined." : ALREADY_REVIEWED);
      setDeclining(null);
      await loadData();
    } finally {
      setBusyRequestId(null);
    }
  }

  async function saveRole({ member, role }: RoleChange) {
    const { data, error } = await supabase
      .from("profiles")
      .update({ role })
      .eq("id", member.id)
      .select("id");

    if (error?.code === LAST_CHURCH_ADMIN) {
      toast.error("Couldn't change this role. A church needs at least one church admin.");
      setRoleChange(null);
      await loadData();
      return;
    }
    if (error || !data?.length) {
      toast.error(failureMessage("change this role"));
      return;
    }

    toast.success("Role changed.");
    setRoleChange(null);
    await loadData();
  }

  const header = (
    <PageHeader
      title="Members"
      actions={
        <>
          <Button
            size="lg"
            className="text-lg"
            nativeButton={false}
            render={<Link href="/admin/members/invite" />}
          >
            <UserPlus className="mr-1 h-5 w-5" aria-hidden="true" />
            Invite member
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="text-lg"
            nativeButton={false}
            render={<Link href="/admin/invite" />}
          >
            Import members
          </Button>
        </>
      }
    />
  );

  if (status !== "ready") {
    return (
      <PageContainer>
        {header}
        {status === "loading" ? (
          <LoadingState thing="members" />
        ) : (
          <ErrorState
            thing="members"
            onRetry={() => {
              setStatus("loading");
              loadData();
            }}
          />
        )}
      </PageContainer>
    );
  }

  const pendingRequests = requests.filter((r) => r.status === "pending");
  const invited = requests.filter(
    (r) =>
      r.status === "approved" &&
      !members.some((m) => displayName(m) === r.name)
  );
  const shownInvited = invited.filter((r) => matchesSearch(query, [r.name, r.email]));
  const shownMembers = members.filter((m) =>
    matchesSearch(query, [displayName(m), m.first_name, m.last_name, m.email]),
  );
  const total = members.length + invited.length;
  const shown = shownMembers.length + shownInvited.length;
  const changeCopy =
    roleChange && roleChangeCopy(displayName(roleChange.member), roleChange.member.role, roleChange.role);

  return (
    <PageContainer>
      {header}

      <Tabs defaultValue={initialTab}>
        <TabsList className="mb-6">
          <TabsTrigger value="members" className="min-h-11 px-6 text-base">
            Members ({total})
          </TabsTrigger>
          <TabsTrigger value="requests" className="min-h-11 px-6 text-base">
            Requests
            {pendingRequests.length > 0 && (
              <Badge variant="destructive" className="ml-2">
                {pendingRequests.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="members">
          <div className="mb-6 max-w-md space-y-2">
            <Label htmlFor="member-search" className="text-base">
              Search members
            </Label>
            <div className="relative">
              <Search
                className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id="member-search"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Name or email"
                autoComplete="off"
                className="pl-10 text-base"
              />
            </div>
            {query.trim() && (
              <p role="status" className="text-base text-muted-foreground">
                {shown} of {total} members
              </p>
            )}
          </div>

          {shown === 0 ? (
            <EmptyState
              icon={Search}
              message={query.trim() ? "No members match that search." : "No members yet."}
              action={
                query.trim() ? (
                  <Button variant="outline" onClick={() => setQuery("")}>
                    Clear search
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="space-y-3">
              {shownInvited.map((req) => (
                <Card key={req.id} className="border-dashed">
                  <CardContent>
                    <p className="text-xl font-semibold">{req.name}</p>
                    <p className="text-base text-muted-foreground">{req.email}</p>
                    <Badge variant="outline" className="mt-1">
                      <Clock className="mr-1 h-4 w-4" aria-hidden="true" />
                      Invited, not signed up yet
                    </Badge>
                  </CardContent>
                </Card>
              ))}
              {shownMembers.map((member) => {
                const lockReason = roleLockReason(member, viewerId, members);
                const controlId = `role-${member.id}`;
                return (
                  <Card key={member.id}>
                    <CardContent>
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                        <div className="min-w-0">
                          <p className="text-xl font-semibold">{displayName(member)}</p>
                          {member.email && (
                            <p className="break-words text-base text-muted-foreground">{member.email}</p>
                          )}
                          {member.role === "pending" && (
                            <Badge variant="outline" className="mt-1">
                              Pending
                            </Badge>
                          )}
                          {lockReason && (
                            <p id={`${controlId}-hint`} className="mt-1 text-base text-muted-foreground">
                              {lockReason}
                            </p>
                          )}
                        </div>
                        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
                          <div className="space-y-1">
                            <Label htmlFor={controlId} className="text-base">
                              Role
                            </Label>
                            <Select
                              items={ROLE_OPTIONS}
                              value={member.role === "pending" ? null : member.role}
                              disabled={lockReason !== null}
                              onValueChange={(v) => {
                                if (v && v !== member.role) {
                                  setRoleChange({ member, role: v as UserRole });
                                }
                              }}
                            >
                              <SelectTrigger
                                id={controlId}
                                aria-describedby={lockReason ? `${controlId}-hint` : undefined}
                                className="w-full text-base sm:w-44"
                              >
                                <SelectValue placeholder="Choose a role" />
                              </SelectTrigger>
                              <SelectContent>
                                {ROLE_OPTIONS.map((r) => (
                                  <SelectItem key={r.value} value={r.value} className="text-base">
                                    {r.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="flex gap-3 *:flex-1 sm:*:flex-none">
                            <Button
                              variant="outline"
                              nativeButton={false}
                              render={<Link href={`/admin/members/${member.id}`} />}
                              aria-label={`Edit ${displayName(member)}`}
                            >
                              <Pencil className="h-4 w-4" aria-hidden="true" />
                              Edit
                            </Button>
                            {member.role !== "pending" && lockReason === null && (
                              <Button
                                variant="outline"
                                onClick={() => setRoleChange({ member, role: "pending" })}
                                aria-label={`Move ${displayName(member)} to pending`}
                              >
                                Move to pending
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="requests">
          <ApprovalQueue
            rows={pendingRequests.map((req) => ({
              id: req.id,
              title: req.name,
              subtitle: req.email,
              quote: req.message ?? undefined,
              meta: `Requested ${requestedOn(req.created_at, timeZone)}`,
            }))}
            onApprove={(id) => {
              const request = pendingRequests.find((r) => r.id === id);
              if (request) approve(request);
            }}
            onDecline={(id) => setDeclining(pendingRequests.find((r) => r.id === id) ?? null)}
            busyId={busyRequestId}
            emptyText="No requests waiting."
          />
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={declining !== null}
        onOpenChange={(open) => !open && setDeclining(null)}
        title={`Decline ${declining?.name ?? ""}'s request?`}
        description="They won't get an invite. They can ask again later."
        confirmLabel="Decline request"
        pendingLabel="Declining…"
        onConfirm={async () => {
          if (declining) await decline(declining);
        }}
      />
      <ConfirmDialog
        open={roleChange !== null}
        onOpenChange={(open) => !open && setRoleChange(null)}
        title={changeCopy?.title ?? ""}
        description={changeCopy?.description}
        confirmLabel={changeCopy?.confirmLabel ?? ""}
        pendingLabel="Saving…"
        onConfirm={async () => {
          if (roleChange) await saveRole(roleChange);
        }}
      />
    </PageContainer>
  );
}
