import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { isMemberRole } from "@/lib/roles";

/**
 * POST /api/profile/resolve-family
 *
 * Accepts { last_name: string } and returns up to 5 family_units whose
 * family_name matches "[LastName] Family" (case-insensitive) and have at
 * least one profiles row assigned.
 *
 * Response: { matches: [{ id, family_name, members: [{ name, relationship }] }] }
 *
 * Called by the profile setup wizard Step 3 to offer auto-matching before
 * creating a new family unit.
 */
export async function POST(request: Request) {
  const supabase = await createClient();

  // Must be authenticated
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { last_name } = body as { last_name?: string };

  if (!last_name || typeof last_name !== "string" || !last_name.trim()) {
    return NextResponse.json({ matches: [] });
  }

  const normalized = last_name.trim()
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
  const searchPattern = `${normalized} Family`;

  // Query family_units with matching name that have at least one profile
  const { data: families, error } = await supabase
    .from("family_units")
    .select(
      `
      id,
      family_name,
      profiles!profiles_family_id_fkey (
        first_name,
        last_name,
        preferred_name,
        relationship,
        role
      )
    `,
    )
    .ilike("family_name", searchPattern)
    .limit(5);

  if (error) {
    console.error("resolve-family error:", error);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }

  // Filter to only families that have at least one active member profile
  const matches = (families ?? [])
    .map((f) => {
      const activeMembers = (
        (f.profiles as Array<{
          first_name: string | null;
          last_name: string | null;
          preferred_name: string | null;
          relationship: string;
          role: string;
        }>) ?? []
      ).filter((p) =>
        isMemberRole(p.role),
      );

      return {
        id: f.id,
        family_name: f.family_name,
        members: activeMembers.map((p) => ({
          name:
            [p.preferred_name || p.first_name, p.last_name]
              .filter(Boolean)
              .join(" ") || "Unknown",
          relationship: p.relationship,
        })),
      };
    })
    .filter((f) => f.members.length > 0);

  return NextResponse.json({ matches });
}
