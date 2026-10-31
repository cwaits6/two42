import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LandingPage } from "@/components/landing/LandingPage";
import { siteConfig } from "@/lib/config";
import { pageTitle } from "@/lib/pageTitle";
import { getOptionalUser } from "@/lib/supabase/current-user";

export async function generateMetadata(): Promise<Metadata> {
  return {
    ...(await pageTitle("Run your church's groups in one place")),
    description: siteConfig.description,
  };
}

export default async function HomePage() {
  // Signed-in members have no use for the front door — send them to the
  // app. Without this, an authenticated visitor to "/" sees the logged-out
  // page under a member header (with "Sign Out"), which reads as a bug.
  if (await getOptionalUser()) {
    redirect("/dashboard");
  }

  return <LandingPage />;
}
