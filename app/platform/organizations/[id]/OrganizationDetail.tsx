"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Globe, Mail, Pause, Play, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ACCENT_CONTRAST_MIN,
  ACCENT_CONTRAST_REFERENCE,
  contrastRatio,
  HEX,
} from "@/lib/contrast";
import type { Database } from "@/lib/supabase/database.types";

type OrgStatus = Database["public"]["Enums"]["org_status"];

export interface OrgDetail {
  id: string;
  name: string;
  slug: string;
  status: OrgStatus;
  // Platform-operator gate on custom sending domains.
  customEmailDomainEnabled: boolean;
  branding: {
    display_name: string;
    logo_url: string;
    accent: string;
    reply_to: string;
  };
}

export interface OwnerRequest {
  name: string;
  email: string;
  inviteOutstanding: boolean;
  tokenExpiresAt: string | null;
}

export interface EmailCapInfo {
  // The effective cap: the org_email_limits override, or the platform
  // default when no override row exists.
  dailyCap: number;
  hasOverride: boolean;
  usedToday: number;
}

export interface EmailDomainRowInfo {
  domain: string;
  status: string;
  // When the most recent provider-side removal attempt failed; only
  // meaningful while status is cleanup_pending.
  cleanupFailedAt: string | null;
}

// loaded: false = the server read failed; the card renders its unavailable
// state. row: null = the org has not claimed a domain.
export type EmailDomainInfo =
  | { loaded: false }
  | { loaded: true; row: EmailDomainRowInfo | null };

interface OrganizationDetailProps {
  org: OrgDetail;
  owner: OwnerRequest | null;
  // null = the server read failed; the card renders its unavailable state.
  emailCap: EmailCapInfo | null;
  emailDomain: EmailDomainInfo;
}

function patchSuccessMessage(kind: "branding" | "status" | "customDomain"): string {
  if (kind === "branding") return "Branding saved.";
  if (kind === "status") return "Status updated.";
  return "Custom email domain setting saved.";
}

function domainStatusVariant(status: string): "secondary" | "destructive" | "outline" {
  if (status === "verified") return "secondary";
  if (status === "cleanup_pending") return "destructive";
  return "outline";
}

// Explicit locale and time zone — a bare toLocaleString() renders in the
// server's zone during SSR and the browser's on hydration.
export function formatUtcTimestamp(value: string): string {
  return new Date(value).toLocaleString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
}

export function OrganizationDetail({
  org,
  owner,
  emailCap,
  emailDomain,
}: OrganizationDetailProps) {
  const router = useRouter();
  const [branding, setBranding] = useState(org.branding);
  const [brandingError, setBrandingError] = useState<string | null>(null);
  const [capInput, setCapInput] = useState(
    emailCap ? String(emailCap.dailyCap) : ""
  );
  const [capError, setCapError] = useState<string | null>(null);
  const [busy, setBusy] = useState<
    "branding" | "invite" | "status" | "emailCap" | "customDomain" | "domainCleanup" | null
  >(null);

  // Display-only readout; the API's validateAccent() is the enforced guard.
  const accentValid = HEX.test(branding.accent);
  const accentRatio = accentValid
    ? contrastRatio(branding.accent, ACCENT_CONTRAST_REFERENCE)
    : null;

  async function patchOrg(
    body: Record<string, unknown>,
    kind: "branding" | "status" | "customDomain"
  ) {
    setBusy(kind);
    if (kind === "branding") setBrandingError(null);
    try {
      const res = await fetch(`/api/platform/organizations/${org.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        const message = data?.error || "Failed to update organization.";
        if (kind === "branding") setBrandingError(message);
        toast.error(message);
        return;
      }
      toast.success(patchSuccessMessage(kind));
      router.refresh();
    } catch (err) {
      console.error(err);
      toast.error("Network error. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function handleSendInvite() {
    if (!owner) return;
    setBusy("invite");
    try {
      const res = await fetch(`/api/platform/organizations/${org.id}/invite-owner`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerEmail: owner.email }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast.error(data?.error || "Failed to send invite.");
        return;
      }
      toast.success(`Invite sent to ${owner.email}.`);
      router.refresh();
    } catch (err) {
      console.error(err);
      toast.error("Network error. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function handleSaveEmailCap() {
    // Display-side validation only; the API mirrors the DB CHECK and is the
    // enforced guard.
    const parsed = Number(capInput);
    if (capInput.trim() === "" || !Number.isInteger(parsed) || parsed < 0) {
      setCapError("Enter a whole number of emails per day (0 or more).");
      return;
    }
    setBusy("emailCap");
    setCapError(null);
    try {
      const res = await fetch(`/api/platform/organizations/${org.id}/email-cap`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ daily_cap: parsed }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        const message = data?.error || "Failed to update the email cap.";
        setCapError(message);
        toast.error(message);
        return;
      }
      toast.success("Email cap saved.");
      router.refresh();
    } catch (err) {
      console.error(err);
      toast.error("Network error. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function handleRetryDomainCleanup() {
    setBusy("domainCleanup");
    try {
      const res = await fetch(
        `/api/platform/organizations/${org.id}/email-domain-cleanup`,
        { method: "POST" }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast.error(data?.error || "Failed to retry the domain cleanup.");
        // The failed attempt is recorded server-side; refresh so the card
        // shows it.
        router.refresh();
        return;
      }
      toast.success("Domain cleanup finished.");
      router.refresh();
    } catch (err) {
      console.error(err);
      toast.error("Network error. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  function handleStatusChange(next: OrgStatus) {
    if (next === "suspended") {
      if (
        !confirm(
          `Suspending stops reminder emails for this organization. Members can still sign in. Suspend ${org.name}?`
        )
      ) {
        return;
      }
    }
    void patchOrg({ status: next }, "status");
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Branding</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="branding-display-name">Display name</Label>
            <Input
              id="branding-display-name"
              value={branding.display_name}
              onChange={(e) => setBranding({ ...branding, display_name: e.target.value })}
              placeholder={org.name}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="branding-accent">Accent color</Label>
            <Input
              id="branding-accent"
              value={branding.accent}
              onChange={(e) => setBranding({ ...branding, accent: e.target.value })}
              placeholder="#B85C38"
            />
            {branding.accent !== "" && (
              <p className="text-sm text-muted-foreground">
                {accentRatio !== null ? (
                  <>
                    {accentRatio >= ACCENT_CONTRAST_MIN ? "Passes" : "Fails"} at{" "}
                    {accentRatio.toFixed(2)}:1 against white text ({ACCENT_CONTRAST_MIN}:1
                    required).
                  </>
                ) : (
                  <>Enter a 6-digit hex color such as #B85C38.</>
                )}
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              Leave empty to use the platform default.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="branding-logo-url">Logo URL</Label>
            <Input
              id="branding-logo-url"
              value={branding.logo_url}
              onChange={(e) => setBranding({ ...branding, logo_url: e.target.value })}
              placeholder="https://example.org/logo.png"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="branding-reply-to">Reply-to email</Label>
            <Input
              id="branding-reply-to"
              type="email"
              value={branding.reply_to}
              onChange={(e) => setBranding({ ...branding, reply_to: e.target.value })}
              placeholder="office@example.org"
            />
          </div>
          {brandingError && (
            <p className="text-base font-medium text-destructive" role="alert">
              {brandingError}
            </p>
          )}
          <Button
            size="lg"
            className="bg-brand-primary hover:bg-brand-primary/90 text-lg"
            disabled={busy === "branding"}
            onClick={() => {
              // page.tsx defaults an absent display_name to "", and the PATCH
              // handler rejects an empty display_name with a 400. Sending the
              // whole object would therefore make accent, logo, and reply_to
              // unsavable for any org that has no display name yet. The
              // handler keys off presence, so omit it when it is blank.
              const { display_name, ...rest } = branding;
              const payload =
                display_name.trim() === "" ? rest : { display_name, ...rest };
              void patchOrg({ branding: payload }, "branding");
            }}
          >
            {busy === "branding" ? "Saving..." : "Save branding"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Founding admin</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {owner ? (
            <>
              <div>
                <p className="text-xl font-semibold">{owner.email}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {owner.inviteOutstanding ? (
                    <>
                      An invite link is outstanding
                      {/* Explicit locale and time zone — a bare
                          toLocaleDateString() renders in the server's zone
                          during SSR and the browser's on hydration. */}
                      {owner.tokenExpiresAt
                        ? ` (expires ${new Date(owner.tokenExpiresAt).toLocaleDateString("en-US", {
                            month: "long",
                            day: "numeric",
                            year: "numeric",
                            timeZone: "UTC",
                          })})`
                        : ""}
                      . Sending again invalidates the previous link.
                    </>
                  ) : (
                    <>No invite has been sent yet.</>
                  )}
                </p>
              </div>
              <Button
                size="lg"
                className="bg-brand-primary hover:bg-brand-primary/90 text-lg"
                disabled={busy === "invite"}
                onClick={() => void handleSendInvite()}
              >
                <Mail className="mr-1 h-5 w-5" />
                {busy === "invite"
                  ? "Sending..."
                  : owner.inviteOutstanding
                    ? "Resend invite"
                    : "Send invite"}
              </Button>
            </>
          ) : (
            <p className="text-base text-muted-foreground">
              No founding-admin request exists for this organization.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Email caps</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {emailCap ? (
            <>
              <p className="text-base">
                Sent today: <span className="font-semibold">{emailCap.usedToday}</span> of{" "}
                <span className="font-semibold">{emailCap.dailyCap}</span>
                {emailCap.hasOverride ? "" : " (platform default)"}
              </p>
              <p className="text-sm text-muted-foreground">
                The daily cap bounds how many emails this organization can send
                per day across reminders, broadcasts, and notifications. Set 0
                to stop all sending.
              </p>
              <div className="space-y-2">
                <Label htmlFor="email-daily-cap">Daily cap</Label>
                <Input
                  id="email-daily-cap"
                  type="number"
                  min={0}
                  value={capInput}
                  onChange={(e) => setCapInput(e.target.value)}
                />
              </div>
              {capError && (
                <p className="text-base font-medium text-destructive" role="alert">
                  {capError}
                </p>
              )}
              <Button
                size="lg"
                className="bg-brand-primary hover:bg-brand-primary/90 text-lg"
                disabled={busy === "emailCap"}
                onClick={() => void handleSaveEmailCap()}
              >
                {busy === "emailCap" ? "Saving..." : "Save email cap"}
              </Button>
            </>
          ) : (
            <p className="text-base text-muted-foreground">
              Email cap information could not be loaded. Refresh to try again.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Custom email domain</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-base">Custom sending domains:</span>
            <Badge variant={org.customEmailDomainEnabled ? "secondary" : "outline"}>
              {org.customEmailDomainEnabled ? "Enabled" : "Not enabled"}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            When enabled, this organization&apos;s admins can claim a sending
            domain through Resend. Each claimed domain uses one of the
            platform&apos;s Resend domain slots, so leave this off unless the
            organization has asked for it.
          </p>
          {emailDomain.loaded ? (
            emailDomain.row ? (
              <p className="text-base">
                Claimed domain:{" "}
                <span className="font-semibold break-all">{emailDomain.row.domain}</span>{" "}
                <Badge
                  variant={domainStatusVariant(emailDomain.row.status)}
                  className="capitalize"
                >
                  {emailDomain.row.status.replace(/_/g, " ")}
                </Badge>
              </p>
            ) : (
              <p className="text-base text-muted-foreground">No domain claimed.</p>
            )
          ) : (
            <p className="text-base text-muted-foreground">
              Domain information could not be loaded. Refresh to try again.
            </p>
          )}
          {org.customEmailDomainEnabled ? (
            <Button
              size="lg"
              variant="outline"
              className="text-lg"
              disabled={busy === "customDomain"}
              onClick={() =>
                void patchOrg({ custom_email_domain_enabled: false }, "customDomain")
              }
            >
              <Globe className="mr-1 h-5 w-5" />
              {busy === "customDomain" ? "Updating..." : "Disable custom domains"}
            </Button>
          ) : (
            <Button
              size="lg"
              className="bg-brand-primary hover:bg-brand-primary/90 text-lg"
              disabled={busy === "customDomain"}
              onClick={() =>
                void patchOrg({ custom_email_domain_enabled: true }, "customDomain")
              }
            >
              <Globe className="mr-1 h-5 w-5" />
              {busy === "customDomain" ? "Updating..." : "Enable custom domains"}
            </Button>
          )}
        </CardContent>
      </Card>

      {emailDomain.loaded && emailDomain.row?.status === "cleanup_pending" && (
        <Card>
          <CardHeader>
            <CardTitle>Domain cleanup</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-base">
              Removing{" "}
              <span className="font-semibold break-all">{emailDomain.row.domain}</span>{" "}
              from the email provider did not finish
              {emailDomain.row.cleanupFailedAt
                ? ` (last tried ${formatUtcTimestamp(emailDomain.row.cleanupFailedAt)})`
                : ""}
              . The domain still uses one of the platform&apos;s Resend slots
              until the cleanup succeeds.
            </p>
            <Button
              size="lg"
              className="bg-brand-primary hover:bg-brand-primary/90 text-lg"
              disabled={busy === "domainCleanup"}
              onClick={() => void handleRetryDomainCleanup()}
            >
              <RefreshCw className="mr-1 h-5 w-5" />
              {busy === "domainCleanup" ? "Retrying..." : "Retry cleanup"}
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Lifecycle</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-base">Current status:</span>
            <Badge variant={org.status === "active" ? "secondary" : "destructive"}>
              {org.status === "active" ? "Active" : "Suspended"}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Suspending stops reminder emails for this organization. Members can
            still sign in.
          </p>
          {org.status === "active" ? (
            <Button
              size="lg"
              variant="destructive"
              className="text-lg"
              disabled={busy === "status"}
              onClick={() => handleStatusChange("suspended")}
            >
              <Pause className="mr-1 h-5 w-5" />
              {busy === "status" ? "Updating..." : "Suspend organization"}
            </Button>
          ) : (
            <Button
              size="lg"
              className="bg-brand-primary hover:bg-brand-primary/90 text-lg"
              disabled={busy === "status"}
              onClick={() => handleStatusChange("active")}
            >
              <Play className="mr-1 h-5 w-5" />
              {busy === "status" ? "Updating..." : "Reactivate organization"}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
