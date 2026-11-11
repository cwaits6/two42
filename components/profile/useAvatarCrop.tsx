"use client";

import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import { toast } from "sonner";
import { failureMessage } from "@/lib/errorCopy";

// The crop step's code is fetched only when a photo is picked.
const AvatarCropStep = dynamic(
  () => import("@/components/profile/AvatarCropStep").then((m) => m.AvatarCropStep),
  { ssr: false },
);

/**
 * Puts the crop step between a profile photo picker and its upload: the
 * picked file opens the step, and only the cropped square reaches `upload`.
 * Cancelling, or a file that does not load as a picture, uploads nothing.
 */
export function useAvatarCrop(upload: (cropped: File) => Promise<void>) {
  const [file, setFile] = useState<File | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    // Cleared so picking the same file again still fires a change.
    e.target.value = "";
    if (picked) setFile(picked);
  };

  const cropStep = file ? (
    <AvatarCropStep
      file={file}
      returnFocusRef={triggerRef}
      onSave={upload}
      onLoadError={() => toast.error(failureMessage("upload the photo"))}
      onClosed={() => setFile(null)}
    />
  ) : null;

  return { onPick, triggerRef, cropStep };
}
