import { pageTitle } from "@/lib/pageTitle";
import { ImportMembers } from "./ImportMembers";

export const generateMetadata = () => pageTitle("Import members");

export default function ImportMembersPage() {
  return <ImportMembers />;
}
