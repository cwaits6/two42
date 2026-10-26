import type { Metadata } from "next";
import { PolicyPlaceholder } from "@/components/landing/PolicyPlaceholder";
import { siteConfig } from "@/lib/config";

export const metadata: Metadata = {
  title: `Privacy | ${siteConfig.name}`,
  robots: { index: false, follow: true },
};

export default function PrivacyPage() {
  return (
    <PolicyPlaceholder
      title="Privacy"
      summary="How two42 handles the information a church and its members put into it."
      status="The full policy is being written."
    />
  );
}
