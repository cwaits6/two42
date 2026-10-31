import { MembersTab } from "@/components/directory/tabs/MembersTab";
import { pageTitle } from "@/lib/pageTitle";

export const generateMetadata = () => pageTitle("Directory");

export default function DirectoryMembersPage() {
  return <MembersTab />;
}
