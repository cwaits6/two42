import { Suspense } from "react";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { LoadingState } from "@/components/states/LoadingState";
import { pageTitle } from "@/lib/pageTitle";
import { ChurchSettings } from "./ChurchSettings";

export const generateMetadata = () => pageTitle("Church settings");

export default function SettingsPage() {
  return (
    <PageContainer>
      <PageHeader title="Church settings" />
      <Suspense fallback={<LoadingState thing="church settings" />}>
        <ChurchSettings />
      </Suspense>
    </PageContainer>
  );
}
