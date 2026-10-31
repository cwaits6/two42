import { AnniversariesTab } from "@/components/directory/tabs/AnniversariesTab";
import { groupPageTitle } from "@/lib/pageTitle";

export const generateMetadata = groupPageTitle("Anniversaries");

export default function GroupDirectoryAnniversariesPage() {
  return <AnniversariesTab />;
}
