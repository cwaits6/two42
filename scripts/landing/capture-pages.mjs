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
import { GROUP, HIDE, PAGES, recordSize, serveThumbnails, signIn, wholeTilesHeight } from "./shared.mjs";

const base = process.env.BASE ?? "http://localhost:3486";
const out = process.env.OUT ?? "public/landing";
const SCALE = 2;
// The signed-in page without the sidebar.
const LEFT = 240;
const WIDTH = 940;
// Each screenshot ends under the last tile that fits whole within this height.
const MAX_HEIGHT = 800;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1180, height: 1200 }, deviceScaleFactor: SCALE });
await serveThumbnails(ctx);
const page = await ctx.newPage();
await signIn(page, base);

for (const { name, path, tiles, prepare, maxHeight = MAX_HEIGHT } of PAGES) {
  await page.goto(`${base}/g/${GROUP}/${path}`, { waitUntil: "networkidle" });
  await prepare?.(page);
  await page.addStyleTag({ content: HIDE });
  await page.waitForTimeout(700);
  const height = await wholeTilesHeight(page, { tiles, maxHeight });
  await page.screenshot({ path: `${out}/${name}.png`, clip: { x: LEFT, y: 0, width: WIDTH, height } });
  await recordSize(name, "desktop", WIDTH * SCALE, height * SCALE);
  console.log("saved", `${name}`, height);
}
await browser.close();
