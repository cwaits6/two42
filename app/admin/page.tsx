import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { siteConfig } from "@/lib/config";
import { PendingRequestsList } from "./PendingRequestsList";

export const metadata = { title: `Admin | ${siteConfig.name}` };

export default async function AdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || !["admin", "content_editor"].includes(profile.role)) {
    redirect("/dashboard");
  }
  const isAdminRole = profile.role === "admin";

  // access_requests SELECT is admin-only under RLS; skip the query entirely
  // for content_editor rather than reading a guaranteed-empty result.
  const pendingRequests = isAdminRole
    ? ((
        await supabase
          .from("access_requests")
          .select("id, name, email, created_at")
          .eq("status", "pending")
          .order("created_at", { ascending: true })
      ).data ?? [])
    : [];

  const quickActions = isAdminRole
    ? [
        { href: "/admin/invite", label: "Invite member" },
        { href: "/admin/events/new", label: "Create event" },
        { href: "/admin/announcements/new", label: "Post announcement" },
      ]
    : [{ href: "/admin/about", label: "Edit about page" }];

  return (
    <PageContainer size="wide">
      <PageHeader title="Admin" />

      <section className="mb-10">
        <h2 className="text-2xl font-bold text-brand-primary mb-4">
          Needs attention
        </h2>
        <PendingRequestsList initialRequests={pendingRequests} />
      </section>

      <section>
        <h2 className="text-2xl font-bold text-brand-primary mb-4">
          Quick actions
        </h2>
        <div className="flex flex-wrap gap-3">
          {quickActions.map((action) => (
            <Button
              key={action.href}
              size="lg"
              variant="outline"
              className="text-lg"
              nativeButton={false}
              render={<Link href={action.href} />}
            >
              {action.label}
            </Button>
          ))}
        </div>
      </section>
    </PageContainer>
  );
}
