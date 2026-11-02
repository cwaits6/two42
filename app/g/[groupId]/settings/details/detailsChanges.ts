import { validateGroupColor } from "@/lib/groups/settings";
import { isHttpsOrEmpty, type AboutChanges } from "../../about/edit/aboutChanges";

export type DetailsFields = {
  color: string;
  videoCallUrl: string;
  videoCallTime: string;
};

export function colorError(color: string): string | undefined {
  return validateGroupColor(color).ok
    ? undefined
    : "Choose a darker or lighter color, so text on it stays easy to read.";
}

export function videoCallUrlError(url: string): string | undefined {
  return isHttpsOrEmpty(url.trim()) ? undefined : "Enter a link that starts with https://";
}

/** The sections of the shared Save that differ from what is saved. */
export function detailsChanges(saved: DetailsFields, draft: DetailsFields): AboutChanges {
  const changes: AboutChanges = {};
  if (draft.color !== saved.color) changes.color = draft.color;
  const url = draft.videoCallUrl.trim();
  const time = draft.videoCallTime.trim();
  if (url !== saved.videoCallUrl || time !== saved.videoCallTime) {
    changes.videoCall = { url, time };
  }
  return changes;
}
