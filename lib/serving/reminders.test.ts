import { describe, expect, it } from "vitest";
import {
  DEFAULT_SEND_HOUR as JOB_DEFAULT_SEND_HOUR,
  FIRST_SEND_HOUR as JOB_FIRST_SEND_HOUR,
  LAST_SEND_HOUR as JOB_LAST_SEND_HOUR,
} from "@/supabase/functions/_shared/serving-due";
import {
  DEFAULT_SEND_HOUR,
  FIRST_SEND_HOUR,
  LAST_SEND_HOUR,
  SEND_HOUR_OPTIONS,
  formatSendHour,
} from "./reminders";

describe("the send time the dialog offers", () => {
  it("agrees with the hourly job on the default and the range", () => {
    expect(DEFAULT_SEND_HOUR).toBe(JOB_DEFAULT_SEND_HOUR);
    expect(FIRST_SEND_HOUR).toBe(JOB_FIRST_SEND_HOUR);
    expect(LAST_SEND_HOUR).toBe(JOB_LAST_SEND_HOUR);
  });

  it("runs from 6:00 AM to 9:00 PM with no Default option", () => {
    expect(SEND_HOUR_OPTIONS[0]).toEqual({ value: "6", label: "6:00 AM" });
    expect(SEND_HOUR_OPTIONS.at(-1)).toEqual({ value: "21", label: "9:00 PM" });
    expect(SEND_HOUR_OPTIONS).toHaveLength(16);
    expect(SEND_HOUR_OPTIONS.some((o) => /default/i.test(o.label))).toBe(false);
  });

  it("formats noon and the default hour", () => {
    expect(formatSendHour(12)).toBe("12:00 PM");
    expect(formatSendHour(DEFAULT_SEND_HOUR)).toBe("9:00 AM");
  });
});
