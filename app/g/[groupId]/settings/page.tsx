import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { createClient } from "@/lib/supabase/server";
import { groupPath } from "@/lib/groups/active";
import { requireActiveGroup } from "@/lib/groups/server";
import { getOptionalUser } from "@/lib/supabase/current-user";
import { groupPageTitle } from "@/lib/pageTitle";

export const generateMetadata = groupPageTitle("Group settings");

const PRIVACY_HREF = "/settings/privacy";

const TILES: { href: string; label: string; description: string }[] = [
  {
    href: "/settings/details",
    label: "Name and description",
    description: "What members see on Home and in the switcher.",
  },
  {
    href: "/settings/about",
    label: "About",
    description: "The summary, leadership, group color and weekly calls.",
  },
  {
    href: PRIVACY_HREF,
    label: "Privacy and joining",
    description: "Who can find this group, how people join it, and requests to join.",
  },
  {
    href: "/settings/invites",
    label: "Invite links",
    description: "Add and revoke links that let people join this group.",
  },
  {
    href: "/settings/announcements",
    label: "Announcements",
    description: "Write, schedule and publish announcements.",
  },
  {
    href: "/settings/lectures",
    label: "Lessons",
    description: "Add lessons and series, with notes and recordings.",
  },
  {
    href: "/settings/giving",
    label: "Giving",
    description: "Add and retire the funds members can give to.",
  },
  {
    href: "/settings/serving",
    label: "Serving",
    description: "Serving email links and who has served.",
  },
  {
    href: "/settings/teams",
    label: "Teams",
    description: "Add serving teams and choose who is on them.",
  },
  {
    href: "/settings/labels",
    label: "Labels",
    description: "Add the labels used to filter this group's members.",
  },
];

function pendingRequestsLabel(count: number): string {
  return `${count} pending request${count === 1 ? "" : "s"}`;
}

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

  // The count is a courtesy: a failed read shows no count and never breaks the hub.
  let pendingRequests = 0;
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("org_id")
    .eq("id", user.id)
    .maybeSingle();
  if (profile) {
    const { count, error } = await supabase
      .from("group_join_requests")
      .select("id", { count: "exact", head: true })
      .eq("org_id", profile.org_id)
      .eq("group_id", group.id)
      .eq("status", "pending");
    if (error) console.error("Failed to count pending join requests: code=%s", error.code);
    pendingRequests = count ?? 0;
  } else {
    console.error("Failed to load the org for the pending request count:", profileError ?? "no row");
  }

  return (
    <PageContainer>
      <PageHeader
        title="Group settings"
        subtitle={`Changes here apply to ${group.name} only.`}
      />

      <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
        {TILES.map((tile) => (
          <li key={tile.href}>
            <Link
              href={groupPath(group.id, tile.href)}
              className="flex min-h-20 items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none sm:px-6"
            >
              <span className="min-w-0">
                <span className="block text-lg font-semibold text-foreground">{tile.label}</span>
                <span className="mt-0.5 block text-base text-muted-foreground">
                  {tile.description}
                </span>
                {tile.href === PRIVACY_HREF && pendingRequests > 0 && (
                  <span className="mt-2 inline-block rounded-full bg-brand-warm px-3 py-1 text-base font-semibold text-foreground">
                    {pendingRequestsLabel(pendingRequests)}
                  </span>
                )}
              </span>
              <ChevronRight className="h-6 w-6 shrink-0 text-muted-foreground" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </PageContainer>
  );
}
