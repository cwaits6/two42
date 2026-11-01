import Link from "next/link";
import { AuthShell } from "@/app/(auth)/_components/AuthShell";
import { buttonVariants } from "@/components/ui/button-variants";

/** The way back from a serving email link to the schedule, signed in or not. */
export function ServingPageLink() {
  return (
    <Link href="/serving" className={buttonVariants({ variant: "outline" })}>
      Go to Serving
    </Link>
  );
}

/**
 * One frame for everything a serving email link can land on. The title reads
 * "{title} {em}." — AuthShell adds the full stop.
 */
export function ServingNotice({
  title,
  em,
  body,
  children = <ServingPageLink />,
}: {
  title: string;
  em: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <AuthShell eyebrow="Serving" title={title} em={em} kicker={body}>
      {children}
    </AuthShell>
  );
}
