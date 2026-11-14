import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";
import { PRIVACY } from "@/components/legal/privacy";
import { TERMS } from "@/components/legal/terms";
import { pageTitle } from "@/lib/pageTitle";

export async function generateMetadata(): Promise<Metadata> {
  return { ...(await pageTitle(TERMS.title)), robots: { index: false, follow: true } };
}

export default function TermsPage() {
  return <LegalPage document={TERMS} companion={{ href: "/privacy", label: PRIVACY.title }} />;
}
