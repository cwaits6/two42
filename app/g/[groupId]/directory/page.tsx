import { MembersTab } from "@/components/directory/tabs/MembersTab";
import { groupPageTitle } from "@/lib/pageTitle";

export const generateMetadata = groupPageTitle("Directory");

export default function GroupDirectoryMembersPage() {
  return <MembersTab />;
}
