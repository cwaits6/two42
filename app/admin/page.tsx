import { redirect } from "next/navigation";

// Church admin has no overview: it opens on the list of members.
export default function AdminPage() {
  redirect("/admin/members");
}
