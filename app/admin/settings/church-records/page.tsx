import { notFound } from "next/navigation";
import { pageTitle } from "@/lib/pageTitle";
import { generateMetadata as notFoundMetadata } from "@/app/not-found";
import { recordsIntegrationEnabled } from "@/lib/integrations/records/enabled";
import { listProviders } from "@/lib/integrations/records/providers";
import { ChurchRecordsSettings } from "./ChurchRecordsSettings";

export const generateMetadata = () => (recordsIntegrationEnabled() ? pageTitle("Church records") : notFoundMetadata());

export default function ChurchRecordsSettingsPage() {
  if (!recordsIntegrationEnabled()) notFound();
  const providers = listProviders().map(({ id, label, connect, intake }) => ({
    id,
    label,
    connect,
    intake: intake?.setup ?? null,
  }));
  return <ChurchRecordsSettings providers={providers} />;
}
