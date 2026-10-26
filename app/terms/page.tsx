import type { Metadata } from "next";
import { PolicyPlaceholder } from "@/components/landing/PolicyPlaceholder";
import { siteConfig } from "@/lib/config";

export const metadata: Metadata = {
  title: `Terms of service | ${siteConfig.name}`,
  robots: { index: false, follow: true },
};

export default function TermsPage() {
  return (
    <PolicyPlaceholder
      title="Terms of service"
      summary="The agreement between two42 and the churches that use the hosted service at two42.io."
      status="The full terms are being written."
    />
  );
}
