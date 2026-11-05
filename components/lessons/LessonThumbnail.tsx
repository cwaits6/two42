"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { thumbnailFailed } from "@/lib/lessons";

/** The lesson's picture, or `fallback` when there is none or the browser or YouTube has nothing to show. */
export function LessonThumbnail({
  src,
  fallback,
}: {
  src: string | null;
  fallback: ReactNode;
}) {
  // Keyed by source so a different picture gets its own attempt.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const ref = useRef<HTMLImageElement>(null);

  // The image usually settles before hydration, so its load and error events
  // have already fired by the time the handlers below attach.
  useEffect(() => {
    const img = ref.current;
    if (img?.complete && thumbnailFailed(img)) setFailedSrc(src);
  }, [src]);

  if (!src || failedSrc === src) return <>{fallback}</>;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={ref}
      src={src}
      alt=""
      className="h-full w-full object-cover"
      onLoad={(e) => {
        if (thumbnailFailed(e.currentTarget)) setFailedSrc(src);
      }}
      onError={() => setFailedSrc(src)}
    />
  );
}
