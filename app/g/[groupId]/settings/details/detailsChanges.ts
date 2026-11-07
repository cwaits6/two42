import { validateGroupColor } from "@/lib/groups/settings";
import type { AboutChanges } from "../../about/edit/aboutChanges";

export type DetailsFields = {
  color: string;
};

export function colorError(color: string): string | undefined {
  return validateGroupColor(color).ok
    ? undefined
    : "Choose a darker or lighter color, so text on it stays easy to read.";
}

/** The sections of the shared Save that differ from what is saved. */
export function detailsChanges(saved: DetailsFields, draft: DetailsFields): AboutChanges {
  const changes: AboutChanges = {};
  if (draft.color !== saved.color) changes.color = draft.color;
  return changes;
}
