"use client";

import { Suspense, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { useSearchParams } from "next/navigation";
import { AuthShell } from "@/app/(auth)/_components/AuthShell";

function JoinFormFields({ orgId, orgSlug }: { orgId: string; orgSlug?: string }) {
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const supabase = createClient(orgSlug);
  const searchParams = useSearchParams();

  // Pre-fill when coming from a family invite link
  const prefilledEmail = searchParams.get("email") ?? "";
  const inviteToken = searchParams.get("invite_token") ?? "";

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const name = formData.get("name") as string;
    const email = formData.get("email") as string;
    const message = formData.get("message") as string;

    try {
      const { error } = await supabase.from("access_requests").insert({
        name,
        email,
        message: message || null,
        // Anon insert: the fail-closed org_id DEFAULT resolves to NULL
        // without a session, so the org is passed explicitly — resolved
        // server-side from the same app_request_org_id() the RLS WITH CHECK
        // evaluates (see app/[orgSlug]/join/page.tsx). The browser client
        // above sends the same x-two42-org the page resolved from — the URL
        // slug — so this org_id and the WITH CHECK cannot disagree.
        org_id: orgId,
        // Store the family invite token on the access request so that when
        // the user creates their account the family link can be established.
        ...(inviteToken ? { invite_token: inviteToken } : {}),
      });

      if (error) {
        // This is the product's only public write path and it is anon-only, so
        // there is no session to debug against. The org_id above comes from
        // the same app_request_org_id() the RLS WITH CHECK evaluates, so a
        // 42501 here means the x-two42-org header did not survive to
        // PostgREST — not that two constants disagree. See
        // docs/security/tenancy-model.md.
        console.error("Access request insert failed:", error);
        toast.error("Something went wrong. Please try again.");
        return;
      }

      setSubmitted(true);
    } catch {
      // Network failure or an unexpected throw from the client.
      toast.error("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="container mx-auto px-4 py-20 max-w-lg text-center">
        <Card className="p-8">
          <CardContent className="pt-6">
            <h1 className="text-3xl font-bold text-brand-primary mb-4">Request Submitted!</h1>
            <p className="text-lg text-muted-foreground">
              Thank you for your interest in joining us. An admin will review your
              request and you&apos;ll receive an email once approved.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <AuthShell
      eyebrow="REQUEST ACCESS"
      title="Join"
      em="our group"
      kicker="Fill out the form below and an admin will review your request."
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="name" className="text-lg">Full Name</Label>
          <Input
            id="name"
            name="name"
            required
            placeholder="Your full name"
            className="text-lg py-6"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email" className="text-lg">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            required
            defaultValue={prefilledEmail}
            readOnly={!!prefilledEmail}
            placeholder="your@email.com"
            className={`text-lg py-6${prefilledEmail ? " bg-muted" : ""}`}
          />
          {prefilledEmail && (
            <p className="text-lg text-muted-foreground">
              Your invite was sent to this email address — please use it to sign up.
            </p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="message" className="text-lg">
            Message <span className="text-muted-foreground">(optional)</span>
          </Label>
          <Textarea
            id="message"
            name="message"
            placeholder="Tell us a little about yourself..."
            rows={4}
            className="text-lg"
          />
        </div>
        <Button
          type="submit"
          size="lg"
          className="w-full text-lg py-6 bg-brand-primary hover:bg-brand-primary/90 text-white"
          disabled={loading}
        >
          {loading ? "Submitting..." : "Submit Request"}
        </Button>
      </form>
    </AuthShell>
  );
}

export function JoinForm({ orgId, orgSlug }: { orgId: string; orgSlug?: string }) {
  return (
    <Suspense fallback={
      <div className="container mx-auto px-4 py-12 max-w-lg">
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground text-lg">
            Loading...
          </CardContent>
        </Card>
      </div>
    }>
      <JoinFormFields orgId={orgId} orgSlug={orgSlug} />
    </Suspense>
  );
}
