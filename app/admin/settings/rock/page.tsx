import { notFound } from "next/navigation";
import { pageTitle } from "@/lib/pageTitle";
import { generateMetadata as notFoundMetadata } from "@/app/not-found";
import { rockIntegrationEnabled } from "@/lib/integrations/rock/enabled";
import { RockSettings } from "./RockSettings";

export const generateMetadata = () => (rockIntegrationEnabled() ? pageTitle("Rock RMS") : notFoundMetadata());

export default function RockSettingsPage() {
  if (!rockIntegrationEnabled()) notFound();
  return <RockSettings />;
}
