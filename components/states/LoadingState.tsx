import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";

interface LoadingStateProps {
  /** What is loading, as it finishes "Loading …", e.g. "the calendar" */
  thing: string;
}

const SKELETON_ROWS = 6;

/** A skeleton of the content area, announced once to screen readers. */
export function LoadingState({ thing }: LoadingStateProps) {
  return (
    <div>
      <p role="status" className="sr-only">
        Loading {thing}
      </p>
      <div className="space-y-2.5" aria-hidden="true">
        {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 min-h-16 px-4 py-3 rounded-xl border border-border bg-card"
          >
            <div className="h-12 w-12 rounded-full bg-muted animate-pulse" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-40 rounded bg-muted animate-pulse" />
              <div className="h-3 w-28 rounded bg-muted animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The page's own title. Leave it out when the title depends on the data, or
 * when routes under the segment carry different titles: a title-shaped
 * placeholder holds its place instead.
 */
type LoadingHeader =
  | { title: string; subtitle?: string }
  | { title?: undefined; subtitle?: undefined };

type PageLoadingProps = LoadingStateProps &
  LoadingHeader & {
    size?: React.ComponentProps<typeof PageContainer>["size"];
  };

/** A route's loading.tsx: the page frame stays, only the content waits. */
export function PageLoading({ title, subtitle, size, ...content }: PageLoadingProps) {
  return (
    <PageContainer size={size}>
      {title ? (
        <PageHeader title={title} subtitle={subtitle} />
      ) : (
        <div className="mb-8" aria-hidden="true">
          <div className="h-10 w-64 max-w-full rounded-lg bg-muted animate-pulse md:h-12" />
        </div>
      )}
      <LoadingState {...content} />
    </PageContainer>
  );
}
