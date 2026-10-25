import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LandingPage } from "@/components/landing/LandingPage";
import { getOptionalUser } from "@/lib/supabase/current-user";

export const metadata: Metadata = {
  title: "two42 · Run your church's groups in one place",
  description:
    "Software for a church's groups: one shared calendar, serving schedule, directory, announcements and prayer requests, with one sign-in for every member.",
};

export default async function HomePage() {
  // Signed-in members have no use for the front door — send them to the
  // app. Without this, an authenticated visitor to "/" sees the logged-out
  // page under a member header (with "Sign Out"), which reads as a bug.
  if (await getOptionalUser()) {
    redirect("/dashboard");
  }

  return <LandingPage />;
}
