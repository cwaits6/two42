import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { AdminSidebarNav } from "@/components/layout/AdminSidebarNav";
import { getOptionalUser } from "@/lib/supabase/current-user";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const user = await getOptionalUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || !["admin", "content_editor"].includes(profile.role)) {
    redirect("/dashboard");
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col md:flex-row">
      <AdminSidebarNav role={profile.role} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
