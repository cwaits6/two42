import { mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { test as base, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { PASSWORD, PERSONAS, type PersonaKey } from "./personas";

const STATE_DIR = path.join(__dirname, "..", ".auth");

// The local GoTrue issues one-hour access tokens. A cached state older than
// this would be refreshed mid-run, and the rotation would strand every other
// context holding the same refresh token, so it is signed in again instead.
const STATE_MAX_AGE_MS = 30 * 60 * 1000;

function isFresh(file: string): boolean {
  try {
    return Date.now() - statSync(file).mtimeMs < STATE_MAX_AGE_MS;
  } catch {
    return false;
  }
}

async function signIn(browser: Browser, baseURL: string, key: PersonaKey, file: string) {
  const persona = PERSONAS[key];
  const context = await browser.newContext({ baseURL });
  try {
    const page = await context.newPage();
    await page.goto("/login");
    await page.getByLabel("Email").fill(persona.email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.locator("form").getByRole("button", { name: "Sign In" }).click();
    await page.waitForURL((url) => url.pathname !== "/login");
    mkdirSync(STATE_DIR, { recursive: true });
    await context.storageState({ path: file });
  } finally {
    await context.close();
  }
}

/** The storage-state file for a persona, signing in through /login when the cache is cold or stale. */
export async function storageStateFor(browser: Browser, baseURL: string, key: PersonaKey) {
  // The origin is part of the key so a state captured for one server is never
  // reused against another within the freshness window.
  const origin = new URL(baseURL).origin.replace(/[^a-zA-Z0-9]+/g, "_");
  const file = path.join(STATE_DIR, `${key}-${origin}.json`);
  if (!isFresh(file)) await signIn(browser, baseURL, key, file);
  return file;
}

/** A second signed-in actor for a test or hook that already has one. */
export async function openAs(
  browser: Browser,
  baseURL: string,
  key: PersonaKey
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    baseURL,
    storageState: await storageStateFor(browser, baseURL, key),
  });
  return { context, page: await context.newPage() };
}

type PersonaOptions = {
  /** Who the built-in page is signed in as; unset leaves it anonymous. */
  persona: PersonaKey | undefined;
};

export const test = base.extend<PersonaOptions>({
  persona: [undefined, { option: true }],
  // Named `provide`, not Playwright's usual `use`: the React hooks lint rule
  // reads a call named use() as the React hook.
  storageState: async ({ storageState, browser, baseURL, persona }, provide) => {
    if (!persona || !baseURL) return provide(storageState);
    await provide(await storageStateFor(browser, baseURL, persona));
  },
});

export { expect } from "@playwright/test";
