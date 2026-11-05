import Link from "next/link";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { buttonVariants } from "@/components/ui/button-variants";
import { pageTitle } from "@/lib/pageTitle";

export const generateMetadata = () => pageTitle("Page not found");

export default function NotFound() {
  return (
    <PageContainer size="reading">
      <PageHeader
        title="Page not found"
        subtitle="This page doesn't exist, or it isn't open to you."
      />
      <Link href="/" className={buttonVariants()}>
        Go to Home
      </Link>
    </PageContainer>
  );
}
