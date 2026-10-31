import { AnniversariesTab } from "@/components/directory/tabs/AnniversariesTab";
import { pageTitle } from "@/lib/pageTitle";

export const generateMetadata = () => pageTitle("Anniversaries");

export default function DirectoryAnniversariesPage() {
  return <AnniversariesTab />;
}
