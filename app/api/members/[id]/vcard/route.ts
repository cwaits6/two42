import { createClient } from "@/lib/supabase/server";
import { mintSignedUrl } from "@/lib/storageRead";
import { displayName } from "@/lib/names";
import type { DirectoryProfile } from "@/lib/types";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const vCard = require("vcf");

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();

  // Require authenticated session
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Query through the privacy-aware directory view (RLS applied)
  const { data: profile, error } = await supabase
    .from("profiles_directory")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !profile) {
    return new Response("Not found", { status: 404 });
  }

  const p = profile as DirectoryProfile;
  const card = new vCard();

  // FN — formatted display name
  card.set("fn", displayName(p));

  // N — structured name: last;first;;;
  card.set(
    "n",
    `${p.last_name ?? ""};${p.first_name ?? ""};;;`,
  );

  // PHOTO — embed as URI if avatar_url is set. Private buckets (CWA-59):
  // the stored URL no longer serves, so embed a signed URL at the default
  // 1h TTL. A contacts app that fetches the photo promptly on import
  // succeeds; a vCard file saved and re-imported later silently loses the
  // photo — an accepted trade-off over a bespoke longer TTL for this one
  // low-severity path.
  if (p.avatar_url) {
    const signedPhoto = await mintSignedUrl(p.avatar_url);
    if (signedPhoto) {
      card.add("photo", signedPhoto, { value: "uri" });
    }
  }

  // TEL — phones with type hints
  if (p.phone_mobile) {
    card.add("tel", p.phone_mobile, { type: "CELL" });
  }
  if (p.phone_home) {
    card.add("tel", p.phone_home, { type: "HOME" });
  }
  if (p.phone_work) {
    card.add("tel", p.phone_work, { type: "WORK" });
  }

  // EMAIL
  if (p.email) {
    card.add("email", p.email);
  }

  // ADR — address (privacy flags already applied by the view)
  if (p.address_line1 || p.city) {
    const street = [p.address_line1, p.address_line2]
      .filter(Boolean)
      .join(" ");
    // vCard 3.0 ADR: PO Box;Extended;Street;City;State;Postal;Country
    const adr = `;; ${street};${p.city ?? ""};${p.state ?? ""};${p.postal_code ?? ""};`;
    card.add("adr", adr, { type: "HOME" });
  }

  // BDAY — YYYYMMDD format (year optional)
  if (p.birth_month && p.birth_day) {
    const year = p.birth_year
      ? String(p.birth_year).padStart(4, "0")
      : "----";
    const month = String(p.birth_month).padStart(2, "0");
    const day = String(p.birth_day).padStart(2, "0");
    card.add("bday", `${year}${month}${day}`);
  }

  // NOTE — bio
  if (p.bio) {
    card.set("note", p.bio);
  }

  // ORG — employer or occupation
  if (p.employer || p.occupation) {
    card.set("org", p.employer ?? p.occupation ?? "");
  }

  // Build filename from actual name
  const firstName = (p.first_name ?? "").replace(/[^a-zA-Z0-9]/g, "");
  const lastName = (p.last_name ?? "").replace(/[^a-zA-Z0-9]/g, "");
  const filename = [firstName, lastName].filter(Boolean).join("-") || "contact";

  return new Response(card.toString("3.0"), {
    status: 200,
    headers: {
      "Content-Type": "text/vcard; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}.vcf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
