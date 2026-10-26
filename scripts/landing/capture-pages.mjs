// Captures the landing-page screenshots of the First Redeemer demo org
// (supabase/demo/first-redeemer.sql, applied through the shared local
// container) into public/landing/. The prayer shot has its own script,
// capture-prayer.mjs.
//
//   npm run dev -- -p 3486
//   USER_EMAIL=karen.thompson@example.test node scripts/landing/capture-pages.mjs
//
// BASE (default http://localhost:3486), OUT (default public/landing) and
// USER_EMAIL (default karen.thompson@example.test, a plain member) are the
// knobs. The committed dashboard.png was taken as susan.anderson@example.test.
import { chromium } from "@playwright/test";

const base = process.env.BASE ?? "http://localhost:3486";
const out = process.env.OUT ?? "public/landing";
const email = process.env.USER_EMAIL ?? "karen.thompson@example.test";
const YF = "de3c0000-0000-0000-0000-00000000c001";
const HIDE = "nextjs-portal{display:none!important}";
// The signed-in page without the header and sidebar.
const CONTENT = { x: 240, y: 70, width: 940, height: 700 };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto(`${base}/login`);
await page.getByLabel("Email").fill(email);
await page.getByLabel("Password").fill("password123");
await page.locator("form").getByRole("button", { name: "Sign In" }).click();
await page.waitForURL((u) => u.pathname !== "/login");

async function shot(name, clip) {
  await page.addStyleTag({ content: HIDE });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/${name}.png`, clip });
  console.log("saved", name, page.url());
}

await page.goto(`${base}/g/${YF}/dashboard`, { waitUntil: "networkidle" });
await shot("dashboard");
await page.goto(`${base}/g/${YF}/serving`, { waitUntil: "networkidle" });
await shot("serving", CONTENT);
await page.goto(`${base}/g/${YF}/calendar`, { waitUntil: "networkidle" });
await page.getByText("List", { exact: true }).first().click();
await shot("calendar-list", CONTENT);
await page.goto(`${base}/g/${YF}/directory`, { waitUntil: "networkidle" });
await shot("directory", CONTENT);
await browser.close();
