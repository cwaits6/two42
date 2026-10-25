// Unit tests for the admin email-settings page: the flag gate on the page
// itself, and the pure helpers of the client component behind it.
// toDnsRecords is the boundary between an untyped `Json` DB column
// (ultimately sourced from Resend's API) and rendered HTML — its own doc
// comment claims a shape change on Resend's side degrades to a partial row,
// never a crash; these tests pin that claim instead of leaving it asserted
// only in prose.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Tables } from "@/lib/supabase/database.types";

class NotFoundSentinel extends Error {}
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFoundSentinel("notFound");
  },
}));

// The surface is hidden in production; the gate tests flip the flag both ways.
const sendingDomains = vi.hoisted(() => ({
  CUSTOM_SENDING_DOMAINS_ENABLED: true,
}));
vi.mock("@/lib/email/sendingDomains", () => sendingDomains);

const { default: EmailDomainSettingsPage } = await import(
  "@/app/admin/settings/email/page"
);
const {
  EmailDomainSettings,
  selectEmailDomainCardState,
  statusLabel,
  statusVariant,
  toDnsRecords,
} = await import("@/app/admin/settings/email/EmailDomainSettings");

type EmailDomainRow = Tables<"org_email_domains">;

afterEach(() => {
  sendingDomains.CUSTOM_SENDING_DOMAINS_ENABLED = true;
});

describe("EmailDomainSettingsPage", () => {
  it("renders the app's 404 before any data read while custom sending domains are off", () => {
    sendingDomains.CUSTOM_SENDING_DOMAINS_ENABLED = false;

    expect(() => EmailDomainSettingsPage()).toThrow(NotFoundSentinel);
  });

  it("renders the settings once the flag is on", () => {
    const element = EmailDomainSettingsPage();

    expect(element.type).toBe(EmailDomainSettings);
  });
});

describe("toDnsRecords", () => {
  it("passes through well-formed records", () => {
    const records = [{ record: "DKIM", name: "resend._domainkey", value: "v=DKIM1" }];
    expect(toDnsRecords(records)).toEqual(records);
  });

  it("degrades to an empty array for non-array input", () => {
    expect(toDnsRecords(null)).toEqual([]);
    expect(toDnsRecords(undefined)).toEqual([]);
    expect(toDnsRecords("not an array")).toEqual([]);
    expect(toDnsRecords({ record: "DKIM" })).toEqual([]);
  });

  it("filters out non-object entries instead of throwing", () => {
    expect(toDnsRecords([{ record: "DKIM" }, null, "garbage", 42, { record: "SPF" }])).toEqual([
      { record: "DKIM" },
      { record: "SPF" },
    ]);
  });

  it("drops fields of the wrong runtime type instead of passing them to render", () => {
    // A numeric status would reach statusLabel(), whose .replace() call
    // throws on a non-string; object-valued name/value would fail React
    // rendering. Each field is normalized independently, so one bad field
    // degrades to a partial row, never a crash.
    expect(
      toDnsRecords([
        { record: "DKIM", status: 123, name: { nested: true }, value: "v=DKIM1" },
        { record: 42, type: "TXT", ttl: 3600, priority: "10" },
      ]),
    ).toEqual([
      { record: "DKIM", value: "v=DKIM1" },
      { type: "TXT" },
    ]);
  });

  it("keeps a numeric priority and string ttl, the shapes Resend documents", () => {
    const record = { record: "MX", priority: 10, ttl: "Auto" };
    expect(toDnsRecords([record])).toEqual([record]);
  });

  it("passes through an empty array unchanged", () => {
    expect(toDnsRecords([])).toEqual([]);
  });
});

describe("statusVariant", () => {
  it("maps verified to default", () => {
    expect(statusVariant("verified")).toBe("default");
  });

  it.each(["pending", "not_started", "partially_verified"])(
    "maps %s to secondary",
    (status) => expect(statusVariant(status)).toBe("secondary"),
  );

  it.each(["failure", "temporary_failure", "failed", "partially_failed"])(
    "maps %s to destructive",
    (status) => expect(statusVariant(status)).toBe("destructive"),
  );

  it("falls back to destructive for an unrecognized status rather than throwing", () => {
    // Deviation 1 widened the status vocabulary specifically to anticipate
    // Resend statuses this UI hasn't seen yet — the fallback is the point.
    expect(statusVariant("made_up_future_status")).toBe("destructive");
  });
});

describe("statusLabel", () => {
  it("replaces underscores with spaces", () => {
    expect(statusLabel("not_started")).toBe("not started");
    expect(statusLabel("partially_verified")).toBe("partially verified");
  });

  it("leaves a status with no underscores unchanged", () => {
    expect(statusLabel("verified")).toBe("verified");
  });
});

describe("selectEmailDomainCardState", () => {
  it("shows the load-failure card when enabled is unknown and there's no row", () => {
    expect(selectEmailDomainCardState(null, null)).toBe("load-failed");
  });

  it("shows the contact-support card when disabled and unclaimed", () => {
    expect(selectEmailDomainCardState(null, false)).toBe("not-enabled");
  });

  it("shows the claim form when enabled and unclaimed", () => {
    expect(selectEmailDomainCardState(null, true)).toBe("claim-form");
  });

  it("shows the claimed-domain card whenever a row exists, regardless of enabled", () => {
    const row = {} as EmailDomainRow;
    expect(selectEmailDomainCardState(row, false)).toBe("claimed");
    expect(selectEmailDomainCardState(row, true)).toBe("claimed");
    expect(selectEmailDomainCardState(row, null)).toBe("claimed");
  });
});
