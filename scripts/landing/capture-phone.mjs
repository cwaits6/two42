// Captures the phone-width landing screenshots (the *-phone.png files the
// landing page serves below the md breakpoint) from the Hillside Church
// sample (supabase/demo/hillside-church.sql, applied through the shared
// local container) into public/landing/.
//
//   npm run dev -- -p 3486
//   node scripts/landing/capture-phone.mjs
//
// BASE (default http://localhost:3486), OUT (default public/landing) and
// USER_EMAIL (default david.carter@example.test, a plain member) are the
// knobs.
import { chromium } from "@playwright/test";
import { GROUP, HIDE, PAGES, serveThumbnails, signIn } from "./shared.mjs";

const base = process.env.BASE ?? "http://localhost:3486";
const out = process.env.OUT ?? "public/landing";
// The signed-in page as a phone shows it, top bar included.
const CONTENT = { x: 0, y: 0, width: 390, height: 640 };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await serveThumbnails(ctx);
const page = await ctx.newPage();
await signIn(page, base);

for (const { name, path, prepare, preparePhone } of PAGES) {
  await page.goto(`${base}/g/${GROUP}/${path}`, { waitUntil: "networkidle" });
  await prepare?.(page);
  await preparePhone?.(page);
  await page.addStyleTag({ content: HIDE });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/${name}-phone.png`, clip: CONTENT });
  console.log("saved", `${name}-phone`, page.url());
}
await browser.close();
