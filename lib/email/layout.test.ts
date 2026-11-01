// Every email, app and edge function alike, rendered with placeholder data and
// never sent: the `resend` package is mocked. The snapshots are the reviewable
// render of each email.

import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { contrastRatio } from "@/lib/contrast";
import { BRANDING_DEFAULTS } from "@/lib/branding";
import {
  formatServiceDateWithYear,
  todayIn,
  upcomingServiceDates,
} from "@/lib/serving/dates";
import * as edgeDates from "@/supabase/functions/_shared/serving-dates";
import {
  EMAIL_COLORS,
  emailLayout,
  eventReminderEmail,
  openDatesEmail,
  servingReminderEmail,
} from "@/supabase/functions/_shared/email-html";

const send = vi.fn().mockResolvedValue({ data: { id: "test" }, error: null });
vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(function () {
    return { emails: { send } };
  }),
}));

const resend = await import("@/lib/email/resend");
const serving = await import("@/lib/email/serving");

const ORG = "Grace Fellowship";
const ACCENT = "#B85C38";
const BRANDING = {
  orgName: ORG,
  replyTo: null,
  accent: ACCENT,
  fromAddress: "noreply@two42.example",
  baseUrl: "https://two42.example",
};
const SETUP = "https://two42.example/setup-account?token=placeholder";
const GO = "https://two42.example/serving/go?token=placeholder";
const SCHEDULE = "https://two42.example/g/group-id/serving/team-id";

type Rendered = { subject: string; html: string };

async function appEmail(sendIt: () => Promise<unknown>): Promise<Rendered> {
  send.mockClear();
  await sendIt();
  const { subject, html } = send.mock.calls[0][0];
  return { subject, html };
}

/** One render of every email there is, with `date` as the service date. */
async function renderAll(date: string): Promise<Record<string, Rendered>> {
  const nextWeek = new Date(Date.parse(`${date}T00:00:00Z`) + 7 * 86400000)
    .toISOString()
    .slice(0, 10);
  const dateLabel = formatServiceDateWithYear(date);
  const person = { to: "ava@example.org", name: "Ava", teamName: "Hospitality", branding: BRANDING };
  return {
    "invite-approved": await appEmail(() =>
      resend.sendInviteEmail("ava@example.org", "Ava Sampleton", SETUP, BRANDING)),
    "invite-member": await appEmail(() =>
      resend.sendMemberInviteEmail("ava@example.org", SETUP, BRANDING)),
    "invite-household": await appEmail(() =>
      resend.sendFamilyInviteEmail("ava@example.org", "Walter Nullington", "Ava Sampleton", SETUP, BRANDING)),
    "invite-group": await appEmail(() =>
      resend.sendGroupInviteEmail("ava@example.org", "Ava Sampleton", "Tuesday Table", SETUP, BRANDING)),
    feedback: await appEmail(() =>
      resend.sendFeedbackEmail(
        ["admin@example.org"],
        "Ava Sampleton",
        "ava@example.org",
        "idea",
        "Could the calendar show\nthe location too?",
        BRANDING,
      )),
    "serving-confirmation": await appEmail(() =>
      serving.sendServingConfirmationEmail({
        ...person,
        serviceDate: date,
        attendeesLabel: "Ava Sampleton",
        cancelUrl: GO,
        icsContent: "BEGIN:VCALENDAR",
      })),
    "serving-cancel-notice": await appEmail(() =>
      serving.sendServingCancelNoticeEmail({
        ...person,
        leaderName: "Walter",
        memberLabel: "Ava Sampleton",
        serviceDate: date,
        servingUrl: SCHEDULE,
      })),
    "serving-broadcast": await appEmail(() =>
      serving.sendServingBroadcastEmail({
        ...person,
        fromName: "Walter Nullington",
        message: "We need one more this month.",
        openDates: [
          { date, url: `${GO}-1` },
          { date: nextWeek, url: `${GO}-2` },
        ],
        scheduleUrl: SCHEDULE,
      })),
    "reminder-serving": servingReminderEmail({
      orgName: ORG,
      accent: ACCENT,
      name: "Ava",
      teamName: "Hospitality",
      dateLabel,
      cancelUrl: GO,
    }),
    "reminder-open-dates": openDatesEmail({
      orgName: ORG,
      accent: ACCENT,
      name: "Ava",
      teamName: "Hospitality",
      dates: [
        { dateLabel, url: `${GO}-1` },
        { dateLabel: formatServiceDateWithYear(nextWeek), url: `${GO}-2` },
      ],
      scheduleUrl: SCHEDULE,
    }),
    "reminder-event": eventReminderEmail({
      orgName: ORG,
      accent: ACCENT,
      name: "Ava",
      title: "Fall potluck",
      dateLabel: "Tuesday, November 10 at 7:00 PM",
      location: "Fellowship hall",
      eventUrl: "https://two42.example/g/group-id/calendar/event-id",
    }),
  };
}

const SERVICE_DATE = "2026-11-08";
const emails = await renderAll(SERVICE_DATE);
// A date that is not on the schedule's weekday: any weekday name in the copy
// then has to have come from the date, not from the template.
const MONDAY = "2026-11-09";
const mondayEmails = await renderAll(MONDAY);

function visibleText(html: string): string {
  return html.replace(/<[^>]*>/g, " ");
}

describe("every email renders", () => {
  it.each(Object.keys(emails))("%s matches its snapshot", async (name) => {
    const { subject, html } = emails[name];
    await expect(`<!-- Subject: ${subject} -->\n${html}\n`).toMatchFileSnapshot(
      `__snapshots__/${name}.html`,
    );
  });
});

describe("app and edge-function emails share one layout", () => {
  const [before, after] = emailLayout(ORG, "@@BODY@@").split("@@BODY@@");

  it.each(Object.keys(emails))("%s sits in the shared frame", (name) => {
    expect(emails[name].html.startsWith(before)).toBe(true);
    expect(emails[name].html.endsWith(after)).toBe(true);
  });

  it("renders the open-dates list the same from either side", () => {
    const dropIntro = (html: string) =>
      html.replace(/<p [^>]*>Hi Ava, .*?<\/p>/, "").replace(/<p [^>]*>We need one more.*?<\/p>/, "");
    expect(dropIntro(emails["serving-broadcast"].html).replace(/\n+/g, "\n")).toBe(
      dropIntro(emails["reminder-open-dates"].html).replace(/\n+/g, "\n"),
    );
  });

  it.each([
    "lib/email/resend.ts",
    "lib/email/serving.ts",
    "supabase/functions/send-event-reminders/index.ts",
    "supabase/functions/send-serving-reminders/index.ts",
  ])("%s builds no markup of its own", (file) => {
    expect(readFileSync(file, "utf8")).not.toMatch(/style=|font-family|<table|<h1|<p[ >]|<div|<a /);
  });
});

describe("copy", () => {
  it.each(Object.keys(mondayEmails))("%s avoids the retired wording", (name) => {
    const { subject, html } = mondayEmails[name];
    expect(`${subject} ${visibleText(html)}`).not.toMatch(
      /sunday|volunteer|click|!|&mdash;|\bthe (hospitality|grace fellowship team)\b/i,
    );
  });

  it.each(["serving-confirmation", "serving-cancel-notice", "serving-broadcast", "reminder-serving", "reminder-open-dates"])(
    "%s shows the actual service date",
    (name) => {
      expect(mondayEmails[name].html).toContain("Monday, November 9, 2026");
    },
  );

  it.each(Object.keys(emails))("%s signs off with the church's name alone", (name) => {
    expect(emails[name].html).toMatch(/>Grace Fellowship<\/p>\s*<\/td>/);
    expect(emails[name].html).not.toMatch(/Team</);
  });
});

describe("the palette", () => {
  const declarations = [
    ...readFileSync("app/globals.css", "utf8").matchAll(/\s(--[\w-]+):\s*(#[0-9A-Fa-f]{6});/g),
  ];

  it.each([
    ["page", "--background"],
    ["card", "--card"],
    ["panel", "--color-brand-warm"],
    ["rule", "--color-brand-bg-muted"],
    ["ink", "--foreground"],
    ["muted", "--muted-foreground"],
    ["link", "--color-brand-primary-text"],
    ["onAccent", "--primary-foreground"],
  ] as const)("EMAIL_COLORS.%s is the app's %s", (name, token) => {
    const declared = declarations.find((declaration) => declaration[1] === token);
    expect(declared?.[2]).toBe(EMAIL_COLORS[name]);
  });
});

describe("contrast on the email's own grounds", () => {
  const { card, panel, ink, muted, link, onAccent } = EMAIL_COLORS;

  it.each([
    ["body text on the card", ink, card],
    ["small print on the card", muted, card],
    ["link on the card", link, card],
    ["body text on a panel", ink, panel],
    ["button text on the default accent", onAccent, BRANDING_DEFAULTS.accent],
  ])("%s holds 4.5:1", (_label, a, b) => {
    expect(contrastRatio(a, b)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("escaping", () => {
  it("keeps markup in a supplied value out of the html", async () => {
    const hostile = "<img src=x onerror=alert(1)>";
    const branded = { ...BRANDING, orgName: hostile };
    const renders = [
      await appEmail(() => resend.sendInviteEmail("a@b.org", hostile, SETUP, branded)),
      await appEmail(() => resend.sendFamilyInviteEmail("a@b.org", hostile, hostile, SETUP, branded)),
      await appEmail(() => resend.sendGroupInviteEmail("a@b.org", hostile, hostile, SETUP, branded)),
      await appEmail(() => resend.sendFeedbackEmail(["a@b.org"], hostile, hostile, "idea", hostile, branded)),
      await appEmail(() =>
        serving.sendServingBroadcastEmail({
          to: "a@b.org",
          name: hostile,
          teamName: hostile,
          fromName: hostile,
          message: hostile,
          openDates: [{ date: SERVICE_DATE, url: GO }],
          scheduleUrl: SCHEDULE,
          branding: branded,
        })),
    ];
    for (const { html } of renders) expect(html).not.toContain("<img");
  });

  it("escapes a link's ampersands in the href", async () => {
    const { html } = await appEmail(() =>
      resend.sendInviteEmail("a@b.org", "Ava", "https://two42.example/s?a=1&b=2", BRANDING));
    expect(html).toContain('href="https://two42.example/s?a=1&amp;b=2"');
    expect(html).not.toContain('href="https://two42.example/s?a=1&b=2"');
  });
});

describe("the edge functions' dates match the app's", () => {
  const INSTANTS = ["2026-11-09T02:00:00Z", "2026-03-08T10:30:00Z", "2026-12-31T23:59:00Z"];
  const ZONES = ["America/Los_Angeles", "America/New_York", "UTC", "Asia/Tokyo"];

  it.each(ZONES)("in %s", (zone) => {
    for (const instant of INSTANTS) {
      const today = todayIn(zone, new Date(instant));
      expect(edgeDates.todayIn(zone, new Date(instant))).toBe(today);
      expect(edgeDates.upcomingServiceDates(6, today)).toEqual(upcomingServiceDates(6, today));
      expect(edgeDates.formatServiceDateWithYear(today)).toBe(formatServiceDateWithYear(today));
    }
  });
});
