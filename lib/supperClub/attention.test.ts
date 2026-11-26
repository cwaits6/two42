import { describe, expect, it } from "vitest";
import { rotationAttention } from "./attention";
import type { ShuffleParty } from "./shuffle";

const NOW = new Date("2027-03-01T12:00:00Z");
const PAST = "2027-02-01T00:00:00Z";
const LATER = "2027-04-01T00:00:00Z";

const party = (id: string, size: 1 | 2, seats?: number): ShuffleParty => ({
  id,
  size,
  canHost: seats !== undefined,
  seats: seats ?? null,
  preferredDateId: null,
  unavailableDateIds: [],
});

function rotation(over: Partial<Parameters<typeof rotationAttention>[0]> = {}) {
  return rotationAttention({
    status: "published",
    format: "same_table_one_host",
    parties: [
      { id: "h1", status: "signed_up" },
      { id: "c1", status: "signed_up" },
      { id: "w1", status: "waitlisted" },
    ],
    shuffleParties: [party("h1", 2, 6), party("c1", 2), party("w1", 2)],
    tables: [{ id: "T1", rotation_date_id: null, position: 1 }],
    seats: [
      { table_id: "T1", party_id: "h1", left_at: null },
      { table_id: "T1", party_id: "c1", left_at: null },
    ],
    suppers: [
      { id: "past", table_id: "T1", rotation_date_id: "d1", starts_at: PAST, host_party_id: "h1", host_unavailable: true },
      { id: "next", table_id: "T1", rotation_date_id: "d2", starts_at: LATER, host_party_id: "h1", host_unavailable: false },
    ],
    dateIds: ["d1", "d2"],
    tableSizeMax: 8,
    now: NOW,
    ...over,
  });
}

describe("rotationAttention", () => {
  it("names who is waiting and the tables with room for them", () => {
    expect(rotation()).toEqual({
      cantHost: [],
      hostLeft: [],
      waiting: ["w1"],
      room: [{ tableId: "T1", rotationDateId: null, free: 2 }],
    });
  });

  it("names a supper still to come whose host can't host, and not one already held", () => {
    const result = rotation({
      suppers: [
        { id: "past", table_id: "T1", rotation_date_id: "d1", starts_at: PAST, host_party_id: "h1", host_unavailable: true },
        { id: "next", table_id: "T1", rotation_date_id: "d2", starts_at: LATER, host_party_id: "h1", host_unavailable: true },
      ],
    });
    expect(result.cantHost).toEqual(["next"]);
  });

  it("names the suppers still to come of a host who withdrew, and counts their seats as the table size", () => {
    const result = rotation({
      parties: [
        { id: "h1", status: "withdrawn" },
        { id: "c1", status: "signed_up" },
        { id: "w1", status: "waitlisted" },
      ],
      shuffleParties: [party("c1", 2), party("w1", 2)],
      seats: [
        { table_id: "T1", party_id: "h1", left_at: PAST },
        { table_id: "T1", party_id: "c1", left_at: null },
      ],
    });
    expect(result.hostLeft).toEqual(["next"]);
    expect(result.room).toEqual([{ tableId: "T1", rotationDateId: null, free: 6 }]);
  });

  it("counts a supper once when its host said they can't host and then withdrew", () => {
    const result = rotation({
      parties: [
        { id: "h1", status: "withdrawn" },
        { id: "c1", status: "signed_up" },
      ],
      shuffleParties: [party("c1", 2)],
      suppers: [
        { id: "next", table_id: "T1", rotation_date_id: "d2", starts_at: LATER, host_party_id: "h1", host_unavailable: true },
      ],
    });
    expect(result.hostLeft).toEqual(["next"]);
    expect(result.cantHost).toEqual([]);
  });

  it("reports no room when nobody is waiting", () => {
    expect(rotation({ parties: [{ id: "h1", status: "signed_up" }] }).room).toEqual([]);
  });

  it("reports nothing for an ended rotation", () => {
    expect(rotation({ status: "ended" })).toEqual({ cantHost: [], hostLeft: [], waiting: [], room: [] });
  });
});
