import Link from "next/link";

/**
 * The one answer to "how do I change my email", wherever the email is shown.
 * During setup Settings redirects back to setup, so that variant has no link.
 */
export function EmailChangeHint({ duringSetup = false }: { duringSetup?: boolean }) {
  if (duringSetup) {
    return (
      <p className="text-base text-muted-foreground">
        You can change your email in Settings after you finish setup.
      </p>
    );
  }
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
