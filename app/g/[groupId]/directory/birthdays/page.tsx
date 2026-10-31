import { BirthdaysTab } from "@/components/directory/tabs/BirthdaysTab";
import { groupPageTitle } from "@/lib/pageTitle";

export const generateMetadata = groupPageTitle("Birthdays");

export default function GroupDirectoryBirthdaysPage() {
  return <BirthdaysTab />;
}
