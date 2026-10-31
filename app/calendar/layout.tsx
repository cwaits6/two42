import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getGroupMemberships } from "@/lib/groups/server";

// The guard sits above loading.tsx: a redirect thrown inside the loading
// boundary streams as a client-side redirect behind a 200.
// A member of no group goes Home, where the no-group card lives.
export default async function CalendarLayout({ children }: { children: ReactNode }) {
  const memberships = await getGroupMemberships();
  if (memberships.length === 0) redirect("/dashboard");
  return children;
}
