import { GroupsTab } from "@/components/directory/tabs/GroupsTab";
import { groupPageTitle } from "@/lib/pageTitle";

export const generateMetadata = groupPageTitle("Groups");

export default function GroupDirectoryGroupsPage() {
  return <GroupsTab />;
}
