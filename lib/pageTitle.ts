import type { Metadata } from "next";
import { siteConfig } from "@/lib/config";
import { getRequestBranding } from "@/lib/branding";
import { getGroupMemberships } from "@/lib/groups/server";
import { getOptionalUser } from "@/lib/supabase/current-user";

const SEPARATOR = " · ";

/**
 * `{Page} · {Group} · {Church}` inside a group, `{Page} · {Church}` elsewhere
 * signed in, `{Page} · two42` signed out. A null church means signed out:
 * the church is never named before sign-in.
 */
export function formatPageTitle(
  page: string,
  frame: { group?: string | null; church: string | null }
): string {
  if (frame.church === null) return [page, siteConfig.name].join(SEPARATOR);
  return [page, frame.group, frame.church].filter(Boolean).join(SEPARATOR);
}

/**
 * Metadata for a page's tab title. Pass `groupId` on a /g/[groupId] page; the
 * group is named only when the viewer is in it.
 */
export async function pageTitle(page: string, opts: { groupId?: string } = {}): Promise<Metadata> {
  if (!(await getOptionalUser())) {
    return { title: formatPageTitle(page, { church: null }) };
  }
  const [branding, memberships] = await Promise.all([
    getRequestBranding(),
    // The page itself reports a failed membership read; the title just
    // leaves the group out.
    opts.groupId ? getGroupMemberships().catch(() => []) : [],
  ]);
  const group = memberships.find((m) => m.id === opts.groupId)?.name;
  return { title: formatPageTitle(page, { group, church: branding.display_name }) };
}

/** `generateMetadata` for a page under /g/[groupId]. */
export function groupPageTitle(page: string) {
  return async ({ params }: { params: Promise<{ groupId: string }> }): Promise<Metadata> =>
    pageTitle(page, { groupId: (await params).groupId });
}
