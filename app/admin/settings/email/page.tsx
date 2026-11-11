import { notFound } from "next/navigation";
import { CUSTOM_SENDING_DOMAINS_ENABLED } from "@/lib/email/sendingDomains";
import { EmailDomainSettings } from "./EmailDomainSettings";
import { pageTitle } from "@/lib/pageTitle";
import { generateMetadata as notFoundMetadata } from "@/app/not-found";

export const generateMetadata = () =>
  CUSTOM_SENDING_DOMAINS_ENABLED ? pageTitle("Email domain") : notFoundMetadata();

export default function EmailDomainSettingsPage() {
  if (!CUSTOM_SENDING_DOMAINS_ENABLED) notFound();
  return <EmailDomainSettings />;
}
