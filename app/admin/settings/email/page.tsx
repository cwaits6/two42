import { notFound } from "next/navigation";
import { CUSTOM_SENDING_DOMAINS_ENABLED } from "@/lib/email/sendingDomains";
import { EmailDomainSettings } from "./EmailDomainSettings";

export default function EmailDomainSettingsPage() {
  if (!CUSTOM_SENDING_DOMAINS_ENABLED) notFound();
  return <EmailDomainSettings />;
}
