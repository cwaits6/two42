"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Building2, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/states/EmptyState";
import { FieldError, invalidFieldProps } from "@/components/ui/field-error";
import { useFieldFocus } from "@/app/(auth)/_components/useFieldFocus";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EMAIL, EMAIL_MAX_LENGTH } from "@/lib/emailAddress";
import { NETWORK_ERROR, operatorMessage } from "@/lib/errorCopy";
import type { Database } from "@/lib/supabase/database.types";
import { logError } from "@/lib/log";

export interface PlatformOrg {
  id: string;
  name: string;
  status: Database["public"]["Enums"]["org_status"];
  created_at: string;
}

interface OrganizationsListProps {
  initialOrgs: PlatformOrg[];
}

type Field = "org-name" | "org-owner-email";
type FieldErrors = Partial<Record<Field, string>>;

/** The Add organization form's errors, keyed by the field each belongs to. */
export function addOrganizationErrors(name: string, ownerEmail: string): FieldErrors {
  const found: FieldErrors = {};
  if (!name) found["org-name"] = "Enter the organization's name.";
  if (!ownerEmail) {
    found["org-owner-email"] = "Enter the first admin's email.";
  } else if (ownerEmail.length > EMAIL_MAX_LENGTH || !EMAIL.test(ownerEmail)) {
    found["org-owner-email"] = "Enter an email address like name@example.com.";
  }
  return found;
}

export function OrganizationsList({ initialOrgs }: OrganizationsListProps) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", ownerEmail: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const focusField = useFieldFocus();
  // Bumped each time the dialog opens. An answer can arrive after the dialog
  // was closed and opened again; it must not mark or close the new one.
  const opening = useRef(0);

  function openDialog(open: boolean) {
    if (open) opening.current += 1;
    setDialogOpen(open);
    setErrors({});
  }

  function edit(field: Field, patch: Partial<typeof form>) {
    setForm({ ...form, ...patch });
    if (field in errors) setErrors({ ...errors, [field]: undefined });
  }

  async function handleCreate() {
    const name = form.name.trim();
    const ownerEmail = form.ownerEmail.trim();
    const found = addOrganizationErrors(name, ownerEmail);
    setErrors(found);
    const first = (Object.keys(found) as Field[])[0];
    if (first) {
      focusField(first);
      return;
    }

    setCreating(true);
    const sentFrom = opening.current;
    try {
      const res = await fetch("/api/platform/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, ownerEmail }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        const message = operatorMessage(res.status, data, "Couldn't add the organization. Try again.");
        // The route answers 409 only about the first admin's email.
        if (res.status === 409 && opening.current === sentFrom) {
          setErrors({ "org-owner-email": message });
          focusField("org-owner-email");
        }
        // Always: the dialog can close before the answer, leaving no field to mark.
        toast.error(message);
        return;
      }
      toast.success(`${name} added.`);
      if (opening.current === sentFrom) {
        setDialogOpen(false);
        setForm({ name: "", ownerEmail: "" });
      }
      router.refresh();
    } catch (err) {
      logError("Platform organization add request failed", err, { route: "/platform/organizations" });
      toast.error(NETWORK_ERROR);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          size="lg"
          className="text-lg"
          onClick={() => openDialog(true)}
        >
          <Plus className="mr-1 h-5 w-5" />
          Add organization
        </Button>
      </div>

      {initialOrgs.length === 0 ? (
        <EmptyState icon={Building2} message="No organizations yet." />
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
                      nativeButton={false}
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

      <Dialog open={dialogOpen} onOpenChange={openDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add organization</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="org-name">Name</Label>
              <Input
                id="org-name"
                value={form.name}
                onChange={(e) => edit("org-name", { name: e.target.value })}
                placeholder="e.g. Grace Chapel"
                {...invalidFieldProps("org-name", errors["org-name"])}
              />
              <FieldError fieldId="org-name" message={errors["org-name"]} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="org-owner-email">First admin&apos;s email</Label>
              <Input
                id="org-owner-email"
                type="email"
                value={form.ownerEmail}
                onChange={(e) => edit("org-owner-email", { ownerEmail: e.target.value })}
                placeholder="e.g. admin@gracechapel.org"
                {...invalidFieldProps("org-owner-email", errors["org-owner-email"])}
              />
              <FieldError fieldId="org-owner-email" message={errors["org-owner-email"]} />
              <p className="text-sm text-muted-foreground">
                They become its church admin. Send their invite from the
                organization page once it is added.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => openDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={creating}
            >
              {creating ? "Adding…" : "Add organization"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
