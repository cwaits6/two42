import { cn } from "@/lib/utils";

type PageContainerSize = "reading" | "default" | "wide";

interface PageContainerProps {
  size?: PageContainerSize;
  /** For a page a signed-out person can reach, which sits in the middle of the screen. */
  centered?: boolean;
  className?: string;
  children: React.ReactNode;
}

const sizeClasses: Record<PageContainerSize, string> = {
  /** Forms and other single-column reading */
  reading: "max-w-2xl",
  /** Standard content pages */
  default: "max-w-4xl",
  /** Data-dense pages: tables, boards, wide grids */
  wide: "max-w-6xl",
};

/**
 * Canonical page wrapper: three named widths sharing one gutter and one
 * vertical rhythm. Every width starts at the left of its frame, so sibling
 * pages beside a sidebar share a left edge whatever their maximum.
 */
export function PageContainer({
  size = "default",
  centered = false,
  className,
  children,
}: PageContainerProps) {
  return (
    <div
      className={cn(
        "w-full px-4 py-12 sm:px-6 lg:px-8",
        sizeClasses[size],
        centered && "mx-auto",
        className,
      )}
    >
      {children}
    </div>
  );
}
