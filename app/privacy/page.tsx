import type { Metadata } from "next";
import { PolicyPlaceholder } from "@/components/landing/PolicyPlaceholder";
import { pageTitle } from "@/lib/pageTitle";

export async function generateMetadata(): Promise<Metadata> {
  return { ...(await pageTitle("Privacy")), robots: { index: false, follow: true } };
}

export default function PrivacyPage() {
  return (
    <PolicyPlaceholder
      title="Privacy"
      summary="How two42 handles the information a church and its members put into it."
      status="The full policy is being written."
    />
  );
}
