import { FamiliesTab } from "@/components/directory/tabs/FamiliesTab";
import { groupPageTitle } from "@/lib/pageTitle";

export const generateMetadata = groupPageTitle("Households");

export default function GroupDirectoryFamiliesPage() {
  return <FamiliesTab />;
}
