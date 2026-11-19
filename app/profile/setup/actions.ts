"use server";

import { revalidatePath } from "next/cache";

/**
 * Drops the browser's cached routes. While setup was unfinished the router
 * prefetched every member page as a redirect back to setup, and it would
 * replay those redirects after setup is finished.
 */
export async function forgetSetupRedirects() {
  revalidatePath("/", "layout");
}
