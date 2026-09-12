// Unit tests for the platform events list's pure helper.
// eventState() drives the badge label/variant and the operator-facing
// action text shown for each unacknowledged event — see DomainsList.test.ts
// for the same pattern applied to leaseState/attachmentState.

import { describe, expect, it } from "vitest";
import { eventState } from "@/app/platform/domains/EventsList";

describe("eventState", () => {
  it("labels attach_permanent_failure as a destructive Attach failed, naming the no-retry rule", () => {
    const state = eventState("attach_permanent_failure");
    expect(state.label).toBe("Attach failed");
    expect(state.variant).toBe("destructive");
    expect(state.action).toMatch(/will not retry/i);
  });

  it("labels detached as an outline Detached, pointing at the allowlist cleanup", () => {
    const state = eventState("detached");
    expect(state.label).toBe("Detached");
    expect(state.variant).toBe("outline");
    expect(state.action).toMatch(/redirect-allowlist/i);
  });

  it("falls back to the raw event name with no action for an unrecognized event", () => {
    expect(eventState("some_future_event")).toEqual({
      label: "some_future_event",
      variant: "secondary",
      action: "",
    });
  });
});
