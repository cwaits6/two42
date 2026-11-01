import { pageTitle } from "@/lib/pageTitle";
import { getOrgTimeZone } from "@/lib/time/orgZone";
import { MembersList } from "./MembersList";

export const generateMetadata = () => pageTitle("Members");

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  return (
    <MembersList
      initialTab={tab === "requests" ? "requests" : "members"}
      timeZone={await getOrgTimeZone()}
    />
  );
}
