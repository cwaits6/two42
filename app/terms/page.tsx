import type { Metadata } from "next";
import { PolicyPlaceholder } from "@/components/landing/PolicyPlaceholder";
import { pageTitle } from "@/lib/pageTitle";

export async function generateMetadata(): Promise<Metadata> {
  return { ...(await pageTitle("Terms of service")), robots: { index: false, follow: true } };
}

export default function TermsPage() {
  return (
    <PolicyPlaceholder
      title="Terms of service"
      summary="The agreement between two42 and the churches that use the hosted service at two42.io."
      status="The full terms are being written."
    />
  );
}
