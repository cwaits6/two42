import { BirthdaysTab } from "@/components/directory/tabs/BirthdaysTab";
import { pageTitle } from "@/lib/pageTitle";

export const generateMetadata = () => pageTitle("Birthdays");

export default function DirectoryBirthdaysPage() {
  return <BirthdaysTab />;
}
