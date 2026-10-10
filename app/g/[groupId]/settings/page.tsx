import Link from "next/link";
import { redirect } from "next/navigation";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { GroupDetailsForm } from "@/components/groups/GroupDetailsForm";
import { createClient } from "@/lib/supabase/server";
import { groupPath } from "@/lib/groups/active";
import { requireActiveGroup } from "@/lib/groups/server";
import { siteConfig } from "@/lib/config";

export const metadata = { title: `Group settings | ${siteConfig.name}` };

// Only tiles whose page exists render; later tickets append theirs here.
const TILES: { href: string; label: string; description: string }[] = [
  {
    href: "#details",
    label: "Name and description",
    description: "What members see on Home and in the switcher.",
  },
];

// Admin content pages stay org-level until the group-scoped-content ticket
// moves them under the group; this list keeps them reachable meanwhile.
const MANAGE_CONTENT: { href: string; label: string }[] = [
  { href: "/admin/events/new", label: "Create event" },
  { href: "/admin/calendars", label: "Event calendars" },
  { href: "/admin/serving", label: "Serving stats" },
  { href: "/admin/lectures", label: "Lectures and series" },
  { href: "/admin/announcements/new", label: "Post announcement" },
  { href: "/admin/about", label: "Edit about page" },
  { href: "/admin/giving", label: "Giving" },
];

export default async function GroupSettingsPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const group = await requireActiveGroup(groupId);
  // A member of the group who does not lead it is not enumerating anything,
  // so this is the switcher's settings fallback, not a 404.
  if (group.role !== "leader") redirect(groupPath(group.id, "/dashboard"));

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: details }, { data: profile }] = await Promise.all([
    supabase.from("groups").select("name, description").eq("id", group.id).maybeSingle(),
    supabase.from("profiles").select("role").eq("id", user.id).single(),
  ]);
  const isOrgAdmin = profile?.role === "admin";

  return (
    <PageContainer>
      <PageHeader
        title="Group settings"
        subtitle={`Changes here apply to ${group.name} only.`}
      />

      <p className="mb-8 text-base font-semibold text-foreground">Your role: Leader</p>

      <div className="space-y-6">
        {TILES.map((tile) => (
          <section
            key={tile.href}
            id={tile.href.replace("#", "")}
            className="rounded-2xl border border-border bg-card p-6"
          >
            <h2 className="text-xl font-bold text-foreground">{tile.label}</h2>
            <p className="mt-1 mb-5 text-base text-muted-foreground">{tile.description}</p>
            <GroupDetailsForm
              groupId={group.id}
              initialName={details?.name ?? group.name}
              initialDescription={details?.description ?? null}
            />
          </section>
        ))}

        {isOrgAdmin && (
          <section className="rounded-2xl border border-border bg-card p-6">
            <h2 className="text-xl font-bold text-foreground">Manage content</h2>
            <p className="mt-1 mb-4 text-base text-muted-foreground">
              These manage content for this group until they move here.
            </p>
            <ul className="space-y-2">
              {MANAGE_CONTENT.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="inline-flex min-h-11 items-center text-base font-semibold text-brand-primary underline underline-offset-4 hover:text-brand-primary/80"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </PageContainer>
  );
}
