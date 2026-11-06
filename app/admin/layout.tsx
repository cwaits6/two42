import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
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

  if (!profile || profile.role !== "admin") {
    redirect("/dashboard");
  }

  return children;
}
