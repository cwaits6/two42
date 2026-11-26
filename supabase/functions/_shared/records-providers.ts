// The providers whose records the nightly refresh can copy from, by the id
// stored in records_connections.provider. The app's own list is
// lib/integrations/records/providers.ts; a provider that offers copying there
// is added here too.
import { rockCopySource } from "./rock-copy.ts";
import { rockHouseholdSource } from "./rock-households.ts";
import type { RecordsCopySource } from "./records-types.ts";

const COPY_SOURCES: Record<string, RecordsCopySource> = {
  rock: { ...rockCopySource(), households: rockHouseholdSource() },
};

/** The copy source for a stored provider id, or null for one that has none. */
export function copySourceFor(id: string): RecordsCopySource | null {
  return Object.hasOwn(COPY_SOURCES, id) ? COPY_SOURCES[id] : null;
}
