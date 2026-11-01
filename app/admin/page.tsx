import { Suspense } from "react";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { LoadingState } from "@/components/states/LoadingState";
import { pageTitle } from "@/lib/pageTitle";
import { AdminOverview } from "./AdminOverview";

export const generateMetadata = () => pageTitle("Overview");

// The layout has already turned away anyone who isn't a church admin.
export default function AdminPage() {
  return (
    <PageContainer size="wide">
      <PageHeader title="Overview" />
      <Suspense fallback={<LoadingState thing="the overview" />}>
        <AdminOverview />
      </Suspense>
    </PageContainer>
  );
}
