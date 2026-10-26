import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { CONTACT_EMAIL, GITHUB_URL } from "./sections";

const LINK = "font-semibold text-foreground underline underline-offset-4 hover:text-secondary-foreground";

// Stands in for a policy page until the document is written, so the footer
// links resolve from day one. Replace the page body, keep the route.
export function PolicyPlaceholder({
  title,
  summary,
  status,
}: {
  title: string;
  summary: string;
  status: string;
}) {
  return (
    <PageContainer size="narrow">
      <PageHeader title={title} subtitle={summary} backHref="/" backLabel="Home" />
      <div className="flex flex-col gap-5 text-xl leading-relaxed">
        <p>
          {status} Until it is published, send any question to{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className={LINK}>
            {CONTACT_EMAIL}
          </a>
          .
        </p>
        <p>
          two42 is{" "}
          <a href={GITHUB_URL} className={LINK}>
            open source
          </a>
          , so what the software does with a church&rsquo;s information can be read at any time.
        </p>
      </div>
    </PageContainer>
  );
}
