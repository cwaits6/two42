import Link from "next/link";
import { notFound } from "next/navigation";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/states/EmptyState";
import { Users } from "lucide-react";
import { isUuid } from "@/lib/groups/active";
import { getGroupMemberships } from "@/lib/groups/server";
import { displayName } from "@/lib/names";
import { pageTitle } from "@/lib/pageTitle";
import { createClient } from "@/lib/supabase/server";

export const generateMetadata = () => pageTitle("Group");

/**
 * What a church admin can see of a group they aren't in. The group's own pages
 * under /g/ are for its members, so this reads through the admin arm of the
 * RLS policies instead of opening those pages to church admins.
 */
export default async function AdminGroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const supabase = await createClient();
  const [{ data: group, error }, memberships] = await Promise.all([
    supabase
      .from("groups")
      .select("id, name, description, group_members(role, profile_id, profiles(first_name, last_name, preferred_name))")
      .eq("id", id)
      .maybeSingle(),
    getGroupMemberships().catch(() => []),
  ]);
  if (error) {
    console.error("Failed to load group:", error.code);
    throw new Error("Failed to load group");
  }
  if (!group) notFound();

  const people = group.group_members
    .map((m) => ({
      id: m.profile_id,
      leader: m.role === "leader",
      name: displayName(Array.isArray(m.profiles) ? m.profiles[0] : m.profiles),
    }))
    .sort((a, b) => Number(b.leader) - Number(a.leader) || a.name.localeCompare(b.name));
  const isMember = memberships.some((m) => m.id === group.id);

  return (
    <PageContainer size="reading">
      <PageHeader
        title={group.name}
        subtitle={group.description ?? undefined}
        backHref="/admin/groups"
        backLabel="Back to Groups"
        actions={
          isMember ? (
            <Button size="lg" nativeButton={false} render={<Link href={`/g/${group.id}/dashboard`} />}>
              Open group
            </Button>
          ) : undefined
        }
      />
      {!isMember && (
        <p className="mb-6 text-lg text-muted-foreground">
          You&apos;re not in this group, so its calendar, lessons and other pages stay with its members.
        </p>
      )}
      {people.length === 0 ? (
        <EmptyState icon={Users} message="No members yet." />
      ) : (
        <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
          {people.map((person) => (
            <li key={person.id} className="flex min-h-11 items-center justify-between gap-3 px-5 py-3">
              <Link
                href={`/admin/members/${person.id}`}
                className="inline-flex min-h-11 items-center text-lg font-medium text-brand-primary-text underline underline-offset-4 hover:text-foreground"
              >
                {person.name}
              </Link>
              {person.leader && <span className="text-base text-muted-foreground">Leader</span>}
            </li>
          ))}
        </ul>
      )}
    </PageContainer>
  );
}
