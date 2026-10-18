/**
 * Whether members of this org can browse and join groups. Off for every org
 * until the discoverability ticket adds the per-org setting; it replaces
 * this body and nothing else, because the root layout, /find-a-group, and
 * buildSidebar() already read discovery from here alone.
 */
export async function getDiscoveryOn(): Promise<boolean> {
  return false;
}
