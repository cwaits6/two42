import { cn } from "@/lib/utils";

type PageContainerSize = "reading" | "default" | "wide";

interface PageContainerProps {
  size?: PageContainerSize;
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
 * vertical rhythm, so sibling pages start at the same left edge.
 */
export function PageContainer({
  size = "default",
  className,
  children,
}: PageContainerProps) {
  return (
    <div
      className={cn(
        "mx-auto w-full px-4 py-12 sm:px-6 lg:px-8",
        sizeClasses[size],
        className,
      )}
    >
      {children}
    </div>
  );
}
