/**
 * A signed-out card's form while the page checks its link or session: the
 * frame and title stay, the fields wait. Announced once to screen readers.
 */
export function AuthFormLoading({ thing }: { thing: string }) {
  return (
    <div>
      <p role="status" className="sr-only">
        Loading {thing}
      </p>
      <div className="space-y-5" aria-hidden="true">
        {[0, 1].map((i) => (
          <div key={i} className="space-y-1.5">
            <div className="h-6 w-32 rounded bg-muted animate-pulse" />
            <div className="h-12 rounded-lg bg-muted animate-pulse" />
          </div>
        ))}
        <div className="h-11 rounded-lg bg-muted animate-pulse" />
      </div>
    </div>
  );
}
