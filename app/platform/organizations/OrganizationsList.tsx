"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isReservedOrgSlug } from "@/lib/org";
import type { Database } from "@/lib/supabase/database.types";

export interface PlatformOrg {
  id: string;
  name: string;
  slug: string;
  status: Database["public"]["Enums"]["org_status"];
  created_at: string;
}

interface OrganizationsListProps {
  initialOrgs: PlatformOrg[];
}

// Mirrors provision_organization()'s TN003 regex so the operator gets a
// clean message before the RPC raises.
const SLUG = /^[a-z0-9][a-z0-9-]{1,62}$/;

// Mirrors EMAIL in lib/branding.ts. Copied rather than imported: that module
// pulls in the server Supabase client, and this is a client component. The
// route handler re-validates with the shared constant — this is only to save
// the operator a round trip.
const EMAIL = /^[^\s@<>,;:"\\]+@[^\s@<>,;:"\\]+\.[^\s@<>,;:"\\]+$/;

export function OrganizationsList({ initialOrgs }: OrganizationsListProps) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", slug: "", ownerEmail: "" });

  async function handleCreate() {
    const name = form.name.trim();
    const slug = form.slug.trim();
    const ownerEmail = form.ownerEmail.trim();
    if (!name || !slug || !ownerEmail) {
      toast.error("Name, slug, and owner email are required.");
      return;
    }
    if (!SLUG.test(slug)) {
      toast.error("Slug must be lowercase letters, numbers, and hyphens.");
      return;
    }
    if (isReservedOrgSlug(slug)) {
      toast.error("That slug is reserved for platform use.");
      return;
    }
    if (ownerEmail.length > 254 || !EMAIL.test(ownerEmail)) {
      toast.error("Enter a valid owner email address.");
      return;
    }

    setCreating(true);
    try {
      const res = await fetch("/api/platform/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, slug, ownerEmail }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast.error(data?.error || "Failed to create organization.");
        return;
      }
      toast.success(`Organization ${name} created.`);
      setDialogOpen(false);
      setForm({ name: "", slug: "", ownerEmail: "" });
      router.refresh();
    } catch (err) {
      console.error(err);
      toast.error("Network error. Please try again.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          size="lg"
          className="bg-brand-primary hover:bg-brand-primary/90 text-lg"
          onClick={() => setDialogOpen(true)}
        >
          <Plus className="mr-1 h-5 w-5" />
          New organization
        </Button>
      </div>

      {initialOrgs.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-base text-muted-foreground">No organizations yet.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {initialOrgs.map((org) => (
            <Card key={org.id}>
              <CardContent className="pt-6">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-xl font-semibold">{org.name}</p>
                      <Badge variant={org.status === "active" ? "secondary" : "destructive"}>
                        {org.status === "active" ? "Active" : "Suspended"}
                      </Badge>
                    </div>
                    <p className="text-base text-muted-foreground">{org.slug}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {/* Locale and time zone are explicit: a bare
                          toLocaleDateString() renders in the server's zone
                          during SSR and the browser's on hydration, which
                          React reports as a mismatch. */}
                      Created{" "}
                      {new Date(org.created_at).toLocaleDateString("en-US", {
                        month: "long",
                        day: "numeric",
                        year: "numeric",
                        timeZone: "UTC",
                      })}
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button
                      size="lg"
                      variant="outline"
                      className="text-lg"
                      render={<Link href={`/platform/organizations/${org.id}`} />}
                    >
                      Manage
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New organization</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="org-name">Name</Label>
              <Input
                id="org-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Grace Chapel"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="org-slug">Slug</Label>
              <Input
                id="org-slug"
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value })}
                placeholder="e.g. grace-chapel"
              />
              <p className="text-sm text-muted-foreground">
                Lowercase letters, numbers, and hyphens.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="org-owner-email">Owner email</Label>
              <Input
                id="org-owner-email"
                type="email"
                value={form.ownerEmail}
                onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })}
                placeholder="e.g. admin@gracechapel.org"
              />
              <p className="text-sm text-muted-foreground">
                The founding admin. Send their invite from the organization page
                after creating.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={creating}
              className="bg-brand-primary hover:bg-brand-primary/90 text-white"
            >
              {creating ? "Creating..." : "Create organization"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
