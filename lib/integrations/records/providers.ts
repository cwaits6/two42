import { rockProvider } from "@/lib/integrations/rock/provider";
import type { RecordsProvider, RecordsProviderId } from "./types";

const PROVIDERS: Record<RecordsProviderId, RecordsProvider> = { rock: rockProvider };

/** The provider for a stored or requested id, or null for one two42 doesn't know. */
export function providerFor(id: unknown): RecordsProvider | null {
  return typeof id === "string" && Object.hasOwn(PROVIDERS, id) ? PROVIDERS[id as RecordsProviderId] : null;
}
