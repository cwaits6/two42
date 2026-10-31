import { FamiliesTab } from "@/components/directory/tabs/FamiliesTab";
import { pageTitle } from "@/lib/pageTitle";

export const generateMetadata = () => pageTitle("Households");

export default function DirectoryFamiliesPage() {
  return <FamiliesTab />;
}
