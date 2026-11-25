import { notFound } from "next/navigation";
import { pageTitle } from "@/lib/pageTitle";
import { generateMetadata as notFoundMetadata } from "@/app/not-found";
import { recordsIntegrationEnabled } from "@/lib/integrations/records/enabled";
import { ChurchRecordsSettings } from "./ChurchRecordsSettings";

export const generateMetadata = () => (recordsIntegrationEnabled() ? pageTitle("Church records") : notFoundMetadata());

export default function ChurchRecordsSettingsPage() {
  if (!recordsIntegrationEnabled()) notFound();
  return <ChurchRecordsSettings />;
}
