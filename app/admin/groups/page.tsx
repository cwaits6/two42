import { Suspense } from "react";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { AdminCreateGroupButton } from "@/components/admin/AdminCreateGroupButton";
import { LoadingState } from "@/components/states/LoadingState";
import { pageTitle } from "@/lib/pageTitle";
import { AdminGroupsContent } from "./AdminGroupsContent";

export const generateMetadata = () => pageTitle("Groups");

export default function AdminGroupsPage() {
  return (
    <PageContainer size="wide">
      <PageHeader title="Groups" actions={<AdminCreateGroupButton />} />
      <Suspense fallback={<LoadingState thing="groups" />}>
        <AdminGroupsContent />
      </Suspense>
    </PageContainer>
  );
}
