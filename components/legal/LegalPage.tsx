import Link from "next/link";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { formatLastUpdated, inlineParts, sectionId, type LegalBlock, type LegalDocument } from "./document";

const LINK = "font-semibold text-foreground underline underline-offset-4 hover:text-secondary-foreground";

export const BASECAMP_POLICIES_URL = "https://github.com/basecamp/policies";
export const CC_BY_URL = "https://creativecommons.org/licenses/by/4.0/";

function Inline({ text }: { text: string }) {
  return inlineParts(text).map((part, i) => {
    if (!("href" in part)) return part.text;
    return part.href.startsWith("/") ? (
      <Link key={i} href={part.href} className={LINK}>
        {part.text}
      </Link>
    ) : (
      <a key={i} href={part.href} className={LINK}>
        {part.text}
      </a>
    );
  });
}

function Block({ block }: { block: LegalBlock }) {
  if (typeof block === "string") {
    return (
      <p>
        <Inline text={block} />
      </p>
    );
  }
  return (
    <ul className="flex list-disc flex-col gap-3 pl-6">
      {block.map((item, i) => (
        <li key={i}>
          <Inline text={item} />
        </li>
      ))}
    </ul>
  );
}

/** A policy page: the document, a link to its companion, and the attribution the adapted text requires. */
export function LegalPage({
  document,
  companion,
}: {
  document: LegalDocument;
  companion: { href: string; label: string };
}) {
  return (
    <PageContainer size="reading" centered>
      <PageHeader title={document.title} subtitle={document.summary} backHref="/" backLabel="Back to Home" />
      <p className="mb-8 text-lg text-muted-foreground">
        Last updated {formatLastUpdated(document.lastUpdated)}
      </p>
      <div className="flex flex-col gap-10 text-xl leading-relaxed">
        {document.sections.map((section) => (
          <section key={section.heading} aria-labelledby={sectionId(section.heading)} className="flex flex-col gap-5">
            <h2 id={sectionId(section.heading)} className="font-serif text-2xl font-medium text-foreground md:text-3xl">
              {section.heading}
            </h2>
            {section.blocks.map((block, i) => (
              <Block key={i} block={block} />
            ))}
          </section>
        ))}
      </div>
      <footer className="mt-12 flex flex-col gap-3 border-t border-border pt-6 text-lg">
        <p>
          <Link href={companion.href} className={`${LINK} inline-flex min-h-11 items-center`}>
            {companion.label}
          </Link>
        </p>
        <p className="text-muted-foreground">
          Adapted from the{" "}
          <a href={BASECAMP_POLICIES_URL} className={LINK}>
            Basecamp open-source policies
          </a>{" "}
          /{" "}
          <a href={CC_BY_URL} className={LINK}>
            CC BY 4.0
          </a>
        </p>
      </footer>
    </PageContainer>
  );
}
