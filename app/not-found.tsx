import Link from "next/link";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { siteConfig } from "@/lib/config";

export const metadata = { title: `Page not found | ${siteConfig.name}` };

export default function NotFound() {
  return (
    <PageContainer size="reading">
      <PageHeader
        title="Page not found"
        subtitle="This page doesn't exist, or it isn't open to you."
      />
      <Button nativeButton={false} render={<Link href="/" />} role="link">
        Go to Home
      </Button>
    </PageContainer>
  );
}
