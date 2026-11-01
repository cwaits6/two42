import Link from "next/link";

/** The one answer to "how do I change my email", wherever the email is shown. */
export function EmailChangeHint() {
  return (
    <p className="text-base text-muted-foreground">
      To change your email, go to{" "}
      <Link
        href="/settings"
        className="font-semibold text-brand-primary-text underline underline-offset-4"
      >
        Settings
      </Link>
      .
    </p>
  );
}
