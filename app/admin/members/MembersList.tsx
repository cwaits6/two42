"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Clock, Ellipsis, Search, UserPlus } from "lucide-react";
import type { AccessRequest, Profile } from "@/lib/types";
import { failureMessage } from "@/lib/errorCopy";
import { invitedNotSignedUp } from "@/lib/members/invited";
import { PROFILE_COLUMNS, type MemberEmail, type ProfileColumns } from "@/lib/profileColumns";
import { toUserRole } from "@/lib/roles";
import { useDeletePerson } from "@/components/account/DeletePersonButton";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/states/EmptyState";
import { ErrorState } from "@/components/states/ErrorState";
import { LoadingState } from "@/components/states/LoadingState";
import { ROLE_LABELS, ROLE_OPTIONS } from "./memberRoles";
import {
  STATUS_LABELS,
  filterMemberRows,
  memberActions,
  statusCounts,
  toMemberRows,
  type MemberRow,
  type MemberStatus,
  type RoleFilter,
  type StatusFilter,
} from "./memberRows";
import { RoleChangeDialog, type RoleChange } from "./RoleChangeDialog";

const ROLE_FILTERS: { value: RoleFilter; label: string }[] = [
  { value: "all", label: "All roles" },
  ...ROLE_OPTIONS,
];

const STATUS_TABS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  ...(Object.keys(STATUS_LABELS) as MemberStatus[]).map((value) => ({ value, label: STATUS_LABELS[value] })),
];

export function MembersList() {
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [members, setMembers] = useState<Profile[]>([]);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [roleChange, setRoleChange] = useState<RoleChange | null>(null);
  const loadedOnce = useRef(false);
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();

  const loadData = useCallback(async () => {
    const [
      { data: reqs, error: requestsError },
      { data: mems, error: membersError },
      { data: emails, error: emailsError },
      { data: auth, error: viewerError },
    ] = await Promise.all([
      supabase
        .from("access_requests")
        .select("*")
        .order("created_at", { ascending: false }),
      supabase
        .from("profiles")
        .select(PROFILE_COLUMNS)
        .order("last_name", { ascending: true })
        .order("first_name", { ascending: true })
        .returns<ProfileColumns[]>(),
      supabase.rpc("admin_member_emails"),
      supabase.auth.getUser(),
    ]);
    // Without the viewer every row would offer Edit only, with no reason shown.
    if (viewerError) console.error("Failed to read the viewer: code=%s", viewerError.code);
    if (emailsError) console.error("Failed to load member emails, code:", emailsError.code);
    if (requestsError || membersError || emailsError || viewerError) {
      if (requestsError || membersError) console.error("Failed to load members:", requestsError ?? membersError);
      if (loadedOnce.current) toast.error(failureMessage("load the latest members"));
      else setStatus("failed");
      return;
    }
    loadedOnce.current = true;
    setViewerId(auth.user?.id ?? null);
    setRequests(reqs || []);
    const emailById = new Map(((emails || []) as MemberEmail[]).map((e) => [e.profile_id, e.email]));
    setMembers(
      (mems || []).map((m) => ({
        ...m,
        email: emailById.get(m.id) ?? null,
        role: toUserRole(m.role),
      })),
    );
    setStatus("ready");
  }, [supabase]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const deletion = useDeletePerson({ subject: "other", onDeleted: loadData });
  const rows = useMemo(
    () => toMemberRows(members, invitedNotSignedUp(requests, members)),
    [members, requests],
  );

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
      <PageContainer size="wide">
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

  const counts = statusCounts(rows, { query, role: roleFilter });
  const shown = filterMemberRows(rows, { query, role: roleFilter, status: statusFilter });
  const searching = query.trim() !== "";
  const filtering = roleFilter !== "all" || statusFilter !== "all";

  // The name's link is the way in by keyboard; the rest of the row is the same
  // target for a pointer. Menu items render in a portal but still bubble here.
  function openRow(event: MouseEvent, row: MemberRow) {
    if (!row.profileId) return;
    if ((event.target as Element).closest('a, button, [role="menu"]')) return;
    router.push(`/admin/members/${row.profileId}`);
  }

  function clearFilters() {
    setQuery("");
    setRoleFilter("all");
    setStatusFilter("all");
  }

  return (
    <PageContainer size="wide">
      {header}

      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="flex w-full max-w-md flex-col gap-2">
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
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="member-role-filter" className="text-base">
            Role
          </Label>
          <Select
            items={ROLE_FILTERS}
            value={roleFilter}
            onValueChange={(value) => value && setRoleFilter(value)}
          >
            <SelectTrigger id="member-role-filter" className="w-full text-base sm:w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLE_FILTERS.map((option) => (
                <SelectItem key={option.value} value={option.value} className="text-base">
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Tabs value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)}>
        <TabsList className="mb-2">
          {STATUS_TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className="px-4 sm:px-6">
              {tab.label} ({counts[tab.value]})
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value={statusFilter}>
          {(searching || filtering) && (
            <p role="status" className="mb-4 text-base text-muted-foreground">
              {shown.length} of {rows.length} members
            </p>
          )}

          {shown.length === 0 ? (
            rows.length === 0 ? (
              <EmptyState icon={Search} message="No members yet." />
            ) : filtering ? (
              <EmptyState
                icon={Search}
                message="No members match those filters."
                action={
                  <Button variant="outline" onClick={clearFilters}>
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={Search}
                message="No members match that search."
                action={
                  <Button variant="outline" onClick={() => setQuery("")}>
                    Clear search
                  </Button>
                }
              />
            )
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden md:table-cell">Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="hidden md:table-cell">Status</TableHead>
                  <TableHead className="w-11">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((row) => {
                  const actions = memberActions(row, viewerId);
                  const { profileId } = row;
                  return (
                    <TableRow
                      key={row.key}
                      onClick={(event) => openRow(event, row)}
                      className={profileId ? "cursor-pointer hover:bg-muted/50" : undefined}
                    >
                      <TableCell className="font-semibold md:whitespace-nowrap">
                        {profileId ? (
                          <Link
                            href={`/admin/members/${profileId}`}
                            className="inline-flex min-h-11 items-center underline-offset-4 hover:underline"
                          >
                            {row.name}
                          </Link>
                        ) : (
                          <span className="inline-flex min-h-11 items-center">{row.name}</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden max-w-72 truncate text-muted-foreground md:table-cell">
                        {row.email}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {row.role
                          ? ROLE_LABELS[row.role]
                          : row.status && <span className="md:hidden">{STATUS_LABELS[row.status]}</span>}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {row.status && (
                          <Badge variant="outline">
                            {row.status === "invited" && <Clock aria-hidden="true" />}
                            {STATUS_LABELS[row.status]}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="pl-0 pr-2">
                        {profileId && (
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              render={
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label={`More actions for ${row.name}`}
                                />
                              }
                            >
                              <Ellipsis aria-hidden="true" />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-auto min-w-48">
                              {actions.includes("edit") && (
                                <DropdownMenuItem
                                  onClick={() => router.push(`/admin/members/${profileId}`)}
                                >
                                  Edit
                                </DropdownMenuItem>
                              )}
                              {actions.includes("pending") && (
                                <DropdownMenuItem
                                  onClick={() =>
                                    setRoleChange({
                                      member: { id: profileId, name: row.name, role: row.role ?? "pending" },
                                      role: "pending",
                                    })
                                  }
                                >
                                  Move to pending
                                </DropdownMenuItem>
                              )}
                              {actions.includes("delete") && (
                                <DropdownMenuItem
                                  variant="destructive"
                                  onClick={() => deletion.request(`/api/admin/members/${profileId}`)}
                                >
                                  Delete account
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </TabsContent>
      </Tabs>

      <RoleChangeDialog change={roleChange} onClose={() => setRoleChange(null)} onSaved={loadData} />
      {deletion.dialog}
    </PageContainer>
  );
}
