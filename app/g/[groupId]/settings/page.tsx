import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { GroupDetailsForm } from "@/components/groups/GroupDetailsForm";
import { createClient } from "@/lib/supabase/server";
import { groupPath } from "@/lib/groups/active";
import { requireActiveGroup } from "@/lib/groups/server";
import { getOptionalUser } from "@/lib/supabase/current-user";
import { groupPageTitle } from "@/lib/pageTitle";

export const generateMetadata = groupPageTitle("Group settings");

// Only tiles whose page exists render; later tickets append theirs here.
const TILES: { href: string; label: string; description: string }[] = [
  {
    href: "/settings/about",
    label: "About",
    description: "The summary, leadership, group color and weekly calls.",
  },
  {
    href: "/settings/privacy",
    label: "Privacy and joining",
    description: "Who can find this group and how people join it.",
  },
  {
    href: "/settings/invites",
    label: "Invite links",
    description: "Links that let people join this group.",
  },
  {
    href: "/settings/announcements",
    label: "Announcements",
    description: "Drafts, scheduled and published announcements.",
  },
  {
    href: "/settings/lectures",
    label: "Lectures",
    description: "Lectures and series.",
  },
  {
    href: "/settings/giving",
    label: "Giving",
    description: "Funds on the Give page.",
  },
  {
    href: "/settings/serving",
    label: "Serving",
    description: "Serving teams, email links and who has served.",
  },
  {
    href: "/settings/teams",
    label: "Teams",
    description: "Greeters, Prayer Team and other serving teams.",
  },
  {
    href: "/settings/labels",
    label: "Labels",
    description: "Men, Women, Tuesday table and other ways to filter your members.",
  },
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
  const user = await getOptionalUser();
  if (!user) redirect("/login");

  const { data: details } = await supabase
    .from("groups")
    .select("name, description")
    .eq("id", group.id)
    .maybeSingle();

  return (
    <PageContainer>
      <PageHeader
        title="Group settings"
        subtitle={`Changes here apply to ${group.name} only.`}
      />

      <p className="mb-8 text-base font-semibold text-foreground">Your role: Leader</p>

      <div className="space-y-6">
        <section id="details" className="rounded-2xl border border-border bg-card p-6">
          <h2 className="text-xl font-bold text-foreground">Name and description</h2>
          <p className="mt-1 mb-5 text-base text-muted-foreground">
            What members see on Home and in the switcher.
          </p>
          <GroupDetailsForm
            groupId={group.id}
            initialName={details?.name ?? group.name}
            initialDescription={details?.description ?? null}
          />
        </section>

        <ul className="grid gap-4 sm:grid-cols-2">
          {TILES.map((tile) => (
            <li key={tile.href}>
              <Link
                href={groupPath(group.id, tile.href)}
                className="flex min-h-24 items-center justify-between gap-4 rounded-2xl border border-border bg-card p-6 transition-colors hover:border-brand-primary"
              >
                <span className="min-w-0">
                  <span className="block text-xl font-bold text-foreground">{tile.label}</span>
                  <span className="mt-1 block text-base text-muted-foreground">
                    {tile.description}
                  </span>
                </span>
                <ChevronRight className="h-6 w-6 shrink-0 text-muted-foreground" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </PageContainer>
  );
}
