import { rockProvider } from "@/lib/integrations/rock/provider";
import type { RecordsIntake, RecordsLiveSource, RecordsProvider, RecordsProviderId } from "./types";

const PROVIDERS: Record<RecordsProviderId, RecordsProvider> = { rock: rockProvider };

/** The provider for a stored or requested id, or null for one two42 doesn't know. */
export function providerFor(id: unknown): RecordsProvider | null {
  return typeof id === "string" && Object.hasOwn(PROVIDERS, id) ? PROVIDERS[id as RecordsProviderId] : null;
}

/** Every provider a church admin can connect, in the order the connect form offers them. */
export function listProviders(): RecordsProvider[] {
  return Object.values(PROVIDERS);
}

/**
 * The provider's live reads, or null when it can't show details live. Live mode
 * needs the copy too: switching back to copy fills the details in through it.
 */
export function liveSourceOf(provider: RecordsProvider | null | undefined): RecordsLiveSource | null {
  return provider?.copy && provider.live ? provider.live : null;
}

/** The provider's way of sending new people, or null when it has none. */
export function intakeOf(provider: RecordsProvider | null | undefined): RecordsIntake | null {
  return provider?.intake ?? null;
}
