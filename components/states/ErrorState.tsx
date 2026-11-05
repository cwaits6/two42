import { requestReference } from "@/lib/log";
import { ErrorStateView } from "./ErrorStateView";

interface ErrorStateProps {
  /** What failed to load, as it finishes "Couldn't load …", e.g. "announcements" */
  thing: string;
  /** Repeats a read made in the browser, which a server refresh would not re-run */
  onRetry?: () => void;
  className?: string;
  /** The reference logged with the failure. A server page's own log lines supply it when omitted. */
  reference?: string;
}

/**
 * A read that failed. Try again re-runs the page's server reads, or `onRetry` when given.
 * Not a client component itself, so that in a server page it can read the reference the
 * request logged; under a client parent there is none to read and none is shown.
 */
export function ErrorState({ reference, ...props }: ErrorStateProps) {
  return <ErrorStateView {...props} reference={reference ?? requestReference()} />;
}
