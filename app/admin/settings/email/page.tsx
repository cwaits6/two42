import { notFound } from "next/navigation";
import { CUSTOM_SENDING_DOMAINS_ENABLED } from "@/lib/email/sendingDomains";
import { EmailDomainSettings } from "./EmailDomainSettings";
import { pageTitle } from "@/lib/pageTitle";

export const generateMetadata = () =>
  pageTitle(CUSTOM_SENDING_DOMAINS_ENABLED ? "Email domain" : "Page not found");

export default function EmailDomainSettingsPage() {
  if (!CUSTOM_SENDING_DOMAINS_ENABLED) notFound();
  return <EmailDomainSettings />;
}
