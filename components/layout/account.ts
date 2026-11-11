import { displayName, hasName, initials, type NameParts } from "@/lib/names";
import { isMemberRole, toUserRole } from "@/lib/roles";
import { INFO_LINKS } from "./infoLinks";

export type AccountRow = {
  href: string;
  label: string;
  /** "own" rows are the person's own pages; "info" rows are the same for everyone. */
  section: "own" | "info";
};

/** Who is signed in, as the frame shows them. Built on the server, once per request. */
export type Account = {
  name: string;
  initials: string;
  photoUrl: string | null;
  isMember: boolean;
  isChurchAdmin: boolean;
  isOperator: boolean;
  /** Has a profile in a church. Must agree with landingFor(), which sends an operator with no profile to Platform. */
  hasChurch: boolean;
  /** The account menu in order; Sign out is an action that follows these. */
  rows: AccountRow[];
};

type AccountProfile = NameParts & { role: string };

export function buildAccount(input: {
  /** The signed-in person's own row; an operator has none. */
  profile: AccountProfile | null;
  /** The sign-in address from the verified session. */
  email: string | null;
  isOperator: boolean;
  photoUrl: string | null;
}): Account {
  const { profile, email, isOperator, photoUrl } = input;
  const isMember = !!profile && isMemberRole(profile.role);
  const isChurchAdmin = !!profile && toUserRole(profile.role) === "admin";
  const named = hasName(profile);

  const rows: AccountRow[] = [];
  // Both pages send anyone who is not an approved member back to Home, so
  // the rows are offered only where they open.
  if (isMember) {
    rows.push(
      { href: "/profile", label: "My profile", section: "own" },
      { href: "/settings", label: "Settings", section: "own" }
    );
  }
  if (isChurchAdmin) rows.push({ href: "/admin", label: "Church admin", section: "own" });
  if (isOperator) rows.push({ href: "/platform", label: "Platform", section: "own" });
  for (const link of INFO_LINKS) rows.push({ ...link, section: "info" });

  return {
    name: named ? displayName(profile) : email ?? "Account",
    initials: named ? initials(profile) : (email ?? "").charAt(0).toUpperCase(),
    photoUrl,
    isMember,
    isChurchAdmin,
    isOperator,
    hasChurch: !!profile,
    rows,
  };
}
