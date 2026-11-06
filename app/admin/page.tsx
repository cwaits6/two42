import { redirect } from "next/navigation";
import { pageTitle } from "@/lib/pageTitle";

export const generateMetadata = () => pageTitle("Members");

// Church admin has no overview: it opens on the list of members.
export default function AdminPage() {
  redirect("/admin/members");
}
