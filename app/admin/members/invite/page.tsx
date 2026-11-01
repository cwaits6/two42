import { createClient } from "@/lib/supabase/server";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { InvitePersonForm } from "./InvitePersonForm";
import { pageTitle } from "@/lib/pageTitle";

export const generateMetadata = () => pageTitle("Invite member");

export default async function InvitePersonPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("family_units")
    .select("id, family_name")
    .order("family_name", { ascending: true });
  if (error) {
    console.error("Invite person: failed to load households:", error.code);
  }

  return (
    <PageContainer size="reading">
      <PageHeader
        title="Invite member"
        subtitle="Send an email invite to set up an account."
        backHref="/admin/members"
        backLabel="Back to Members"
      />
      <InvitePersonForm
        households={
          error
            ? null
            : (data ?? []).map((h) => ({ value: h.id, label: h.family_name }))
        }
      />
    </PageContainer>
  );
}
