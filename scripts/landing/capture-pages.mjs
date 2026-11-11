// Captures the landing-page screenshots at desktop width from the Hillside
// Church sample (supabase/demo/hillside-church.sql, applied through the
// shared local container) into public/landing/. capture-phone.mjs takes the
// phone-width set.
//
//   npm run dev -- -p 3486
//   node scripts/landing/capture-pages.mjs
//
// BASE (default http://localhost:3486), OUT (default public/landing) and
// USER_EMAIL (default david.carter@example.test, a plain member) are the
// knobs.
import { chromium } from "@playwright/test";
import { GROUP, HIDE, PAGES, serveThumbnails, signIn } from "./shared.mjs";

const base = process.env.BASE ?? "http://localhost:3486";
const out = process.env.OUT ?? "public/landing";
// The signed-in page without the sidebar.
const CONTENT = { x: 240, y: 0, width: 940, height: 700 };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2 });
await serveThumbnails(ctx);
const page = await ctx.newPage();
await signIn(page, base);

for (const { name, path, prepare } of PAGES) {
  await page.goto(`${base}/g/${GROUP}/${path}`, { waitUntil: "networkidle" });
  await prepare?.(page);
  await page.addStyleTag({ content: HIDE });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/${name}.png`, clip: CONTENT });
  console.log("saved", name, page.url());
}
await browser.close();
