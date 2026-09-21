import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { siteConfig } from "@/lib/config";
import { isValidOrgSlug } from "@/lib/org";
import { PageRenderer } from "./PageRenderer";

interface Props {
  params: Promise<{ orgSlug: string; slug: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { orgSlug, slug } = await params;

  // Same shape-check as app/[orgSlug]/join/page.tsx — route params arrive
  // URL-decoded, so a malformed slug must be rejected before it reaches the
  // `x-two42-org` header rather than sent through as a raw header value.
  if (!isValidOrgSlug(orgSlug)) {
    return { title: "Page Not Found" };
  }

  const supabase = await createClient(orgSlug);
  const { data } = await supabase
    .from("page_content")
    .select("title")
    .eq("slug", slug)
    .single();

  return {
    title: data ? `${data.title} | ${siteConfig.name}` : "Page Not Found",
  };
}

export default async function PublicPage({ params }: Props) {
  const { orgSlug, slug } = await params;

  if (!isValidOrgSlug(orgSlug)) {
    notFound();
  }

  // The URL slug — not the env slug — is the org this request is
  // about, same as app/[orgSlug]/join/page.tsx.
  const supabase = await createClient(orgSlug);
  const { data: page } = await supabase
    .from("page_content")
    .select("*")
    .eq("slug", slug)
    .single();

  if (!page) notFound();

  return (
    <div className="container mx-auto px-4 py-12 max-w-4xl">
      <h1 className="text-3xl md:text-4xl font-bold text-brand-primary mb-8">
        {page.title}
      </h1>
      <PageRenderer body={page.body} />
    </div>
  );
}
