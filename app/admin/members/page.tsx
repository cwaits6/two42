import { redirect } from "next/navigation";
import { pageTitle } from "@/lib/pageTitle";
import { MembersList } from "./MembersList";

export const generateMetadata = () => pageTitle("Members");

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  // Access requests were a tab here; links to it land where they are reviewed.
  if ((await searchParams).tab === "requests") redirect("/admin/requests");
  return <MembersList />;
}
