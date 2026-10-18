import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GivingSettings } from "@/components/giving/GivingSettings";
import { getGivingSettings } from "@/lib/giving/server";
import { siteConfig } from "@/lib/config";

export const metadata = { title: `Org settings | Admin | ${siteConfig.name}` };

export default async function SettingsPage() {
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
  if (profile?.role !== "admin") redirect("/dashboard");

  const givingSettings = await getGivingSettings(supabase, profile.org_id);

  return (
    <div className="container mx-auto px-4 py-12 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-3xl text-brand-primary">Org settings</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-8 flex flex-col gap-3 sm:flex-row">
            <Button
              size="lg"
              variant="outline"
              className="text-lg"
              nativeButton={false}
              render={<Link href="/admin/settings/email" />}
            >
              Email sending domain
            </Button>
          </div>
          <h2 className="mb-3 text-xl font-bold text-foreground">Giving</h2>
          <GivingSettings
            stewardsCanManage={givingSettings.stewardsCanManage}
            dashboardTile={givingSettings.dashboardTile}
          />
        </CardContent>
      </Card>
    </div>
  );
}
