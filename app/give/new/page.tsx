import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { siteConfig } from "@/lib/config";
import { FundForm } from "@/components/giving/FundForm";
import {
  givingStewardsCanManage,
  loadFundFormData,
} from "@/lib/giving/server";

export const metadata = { title: `New Fund | ${siteConfig.name}` };

export default async function NewFundPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, org_id")
    .eq("id", user.id)
    .single();
  if (!profile || profile.role === "pending") redirect("/dashboard");
  const isAdmin = profile.role === "admin";

  const stewardsCanManage = await givingStewardsCanManage(supabase, profile.org_id);
  if (!isAdmin && !stewardsCanManage) redirect("/give");

  const { members } = await loadFundFormData(supabase, profile.org_id);

  return (
    <div className="container mx-auto px-4 py-12 max-w-5xl">
      <h1 className="text-3xl md:text-4xl font-bold text-brand-primary mb-10">
        New Fund
      </h1>
      <FundForm
        fund={null}
        members={members}
        currentUserId={user.id}
        isAdmin={isAdmin}
        backHref="/give"
      />
    </div>
  );
}
