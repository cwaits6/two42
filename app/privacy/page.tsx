import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";
import { PRIVACY } from "@/components/legal/privacy";
import { pageTitle } from "@/lib/pageTitle";

export async function generateMetadata(): Promise<Metadata> {
  return { ...(await pageTitle("Privacy")), robots: { index: false, follow: true } };
}

export default function PrivacyPage() {
  return <LegalPage document={PRIVACY} companion={{ href: "/terms", label: "Terms of service" }} />;
}
