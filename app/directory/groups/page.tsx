import { GroupsTab } from "@/components/directory/tabs/GroupsTab";
import { pageTitle } from "@/lib/pageTitle";

export const generateMetadata = () => pageTitle("Groups");

export default function DirectoryGroupsPage() {
  return <GroupsTab />;
}
