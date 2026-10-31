import { pageTitle } from "@/lib/pageTitle";
import { MembersList } from "./MembersList";

export const generateMetadata = () => pageTitle("Manage members");

export default function MembersPage() {
  return <MembersList />;
}
