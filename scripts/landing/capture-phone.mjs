// Captures the phone-width landing screenshots (the *-phone.png files the
// landing page serves below the md breakpoint) of the First Redeemer demo
// org (supabase/demo/first-redeemer.sql, applied through the shared local
// container) into public/landing/.
//
//   npm run dev -- -p 3486
//   node scripts/landing/capture-phone.mjs
//
// BASE (default http://localhost:3486), OUT (default public/landing) and
// USER_EMAIL (default karen.thompson@example.test, a plain member) are the
// knobs.
import { chromium } from "@playwright/test";

const base = process.env.BASE ?? "http://localhost:3486";
const out = process.env.OUT ?? "public/landing";
const email = process.env.USER_EMAIL ?? "karen.thompson@example.test";
const YF = "de3c0000-0000-0000-0000-00000000c001";
const HIDE = "nextjs-portal{display:none!important}";
// The signed-in page below the header, one phone screen tall.
const CONTENT = { x: 0, y: 72, width: 390, height: 640 };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto(`${base}/login`);
await page.getByLabel("Email").fill(email);
await page.getByLabel("Password").fill("password123");
await page.locator("form").getByRole("button", { name: "Sign in" }).click();
await page.waitForURL((u) => u.pathname !== "/login");

for (const name of ["dashboard", "serving", "calendar", "directory", "prayer"]) {
  await page.goto(`${base}/g/${YF}/${name}`, { waitUntil: "networkidle" });
  await page.addStyleTag({ content: HIDE });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/${name}-phone.png`, clip: CONTENT });
  console.log("saved", `${name}-phone`, page.url());
}
await browser.close();
