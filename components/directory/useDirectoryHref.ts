"use client";

import { useParams } from "next/navigation";
import { groupPath } from "@/lib/groups/active";

/**
 * The directory root for the page being rendered: the org-level one, or the
 * group's own when the client page is mounted under /g/[groupId]/directory.
 */
export function useDirectoryHref(): string {
  const { groupId } = useParams<{ groupId?: string }>();
  return groupId ? groupPath(groupId, "/directory") : "/directory";
}
