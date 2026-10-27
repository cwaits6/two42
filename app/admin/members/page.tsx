"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Check, X, UserCog, Clock, Pencil } from "lucide-react";
import type { AccessRequest, Profile, UserRole } from "@/lib/types";
import { displayName } from "@/lib/names";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";

const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "member", label: "Member" },
  { value: "content_editor", label: "Content Editor" },
  { value: "admin", label: "Admin" },
];

export default function MembersPage() {
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [members, setMembers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = useMemo(() => createClient(), []);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [{ data: reqs }, { data: mems }] = await Promise.all([
      supabase
        .from("access_requests")
        .select("*")
        .order("created_at", { ascending: false }),
      supabase
        .from("profiles")
        .select("*")
        .order("last_name", { ascending: true })
        .order("first_name", { ascending: true }),
    ]);
    setRequests(reqs || []);
    setMembers(mems || []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleRequest(id: string, action: "approved" | "denied") {
    if (action === "approved") {
      const request = requests.find((r) => r.id === id);
      if (request) {
        const res = await fetch("/api/admin/approve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: request.email, name: request.name }),
        });
        if (!res.ok) {
          toast.error("Failed to approve request.");
          return;
        }
      }
    } else {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error("Session expired. Please log in again.");
        return;
      }
      const { error } = await supabase
        .from("access_requests")
        .update({
          status: action,
          reviewed_by: user.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", id);

      if (error) {
        toast.error("Failed to update request.");
        return;
      }
    }

    toast.success(`Request ${action}.`);
    loadData();
  }

  async function handleRoleChange(userId: string, newRole: UserRole) {
    const { error } = await supabase
      .from("profiles")
      .update({ role: newRole })
      .eq("id", userId);

    if (error) {
      toast.error("Failed to update role.");
      return;
    }

    toast.success("Role updated.");
    loadData();
  }

  const pendingRequests = requests.filter((r) => r.status === "pending");
  const approvedNotSignedUp = requests.filter(
    (r) =>
      r.status === "approved" &&
      !members.some((m) => displayName(m) === r.name)
  );

  if (loading) {
    return (
      <PageContainer>
        <p className="text-xl text-muted-foreground">Loading...</p>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader title="Manage Members" />

      <Tabs defaultValue="requests">
        <TabsList className="mb-6">
          <TabsTrigger value="requests" className="text-base px-6">
            Requests
            {pendingRequests.length > 0 && (
              <Badge variant="destructive" className="ml-2">
                {pendingRequests.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="members" className="text-base px-6">
            Members ({members.length + approvedNotSignedUp.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="requests">
          {pendingRequests.length === 0 ? (
            <p className="text-lg text-muted-foreground">No pending requests.</p>
          ) : (
            <div className="space-y-4">
              {pendingRequests.map((req) => (
                <Card key={req.id}>
                  <CardContent className="pt-6">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div>
                        <p className="text-xl font-semibold">{req.name}</p>
                        <p className="text-base text-muted-foreground">{req.email}</p>
                        {req.message && (
                          <p className="text-base mt-2 italic">&ldquo;{req.message}&rdquo;</p>
                        )}
                        <p className="text-sm text-muted-foreground mt-1">
                          {new Date(req.created_at).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <Button
                          size="lg"
                          className="text-lg"
                          onClick={() => handleRequest(req.id, "approved")}
                        >
                          <Check className="mr-1 h-5 w-5" />
                          Approve
                        </Button>
                        <Button
                          size="lg"
                          variant="destructive"
                          className="text-lg"
                          onClick={() => handleRequest(req.id, "denied")}
                        >
                          <X className="mr-1 h-5 w-5" />
                          Deny
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="members">
          <div className="space-y-3">
            {approvedNotSignedUp.map((req) => (
              <Card key={req.id} className="border-dashed">
                <CardContent className="pt-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <p className="text-xl font-semibold text-muted-foreground">
                        {req.name}
                      </p>
                      <p className="text-sm text-muted-foreground">{req.email}</p>
                      <Badge variant="outline" className="mt-1">
                        <Clock className="mr-1 h-3 w-3" />
                        Invited — awaiting signup
                      </Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
            {members.map((member) => (
              <Card key={member.id}>
                <CardContent className="pt-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <p className="text-xl font-semibold">
                        {displayName(member)}
                      </p>
                      {member.email && (
                        <p className="text-sm text-muted-foreground">
                          {member.email}
                        </p>
                      )}
                      <Badge
                        variant={
                          member.role === "admin"
                            ? "default"
                            : member.role === "member"
                            ? "secondary"
                            : "outline"
                        }
                        className="mt-1"
                      >
                        {member.role}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <UserCog className="h-5 w-5 text-muted-foreground" />
                      <Select
                        items={ROLE_OPTIONS}
                        defaultValue={member.role}
                        onValueChange={(v) =>
                          handleRoleChange(member.id, v as UserRole)
                        }
                      >
                        <SelectTrigger className="w-[140px] text-base">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ROLE_OPTIONS.map((r) => (
                            <SelectItem key={r.value} value={r.value}>
                              {r.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        variant="outline"
                        size="sm"
                        nativeButton={false}
                        render={<Link href={`/admin/members/${member.id}`} />}
                      >
                        <Pencil className="mr-1 h-4 w-4" />
                        Edit
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}
