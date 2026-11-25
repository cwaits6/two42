import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RockPerson } from "./client";

const client = vi.hoisted(() => ({
  checkConnection: vi.fn(),
  definedValueIds: vi.fn(),
  peopleByLastName: vi.fn(),
  peopleByIds: vi.fn(),
}));
vi.mock("./client", () => client);

import { linkable, rockProvider, toRecordsPerson } from "./provider";

const ids = { recordTypePerson: 1, recordStatusInactive: 4 };
const creds = { baseUrl: "https://rock.example.org", key: "k" };

function rockPerson(over: Partial<RockPerson> = {}): RockPerson {
  return {
    id: 100,
    firstName: "Margaret",
    nickName: "Peggy",
    lastName: "O'Brien",
    email: "obriens@example.org",
    birthMonth: 4,
    birthDay: 12,
    birthYear: 1961,
    recordTypeValueId: 1,
    recordStatusValueId: 3,
    isDeceased: false,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  client.definedValueIds.mockResolvedValue(ids);
});

describe("linkable", () => {
  it("refuses businesses, the deceased and inactive records", () => {
    expect(linkable(rockPerson(), ids)).toBe(true);
    expect(linkable(rockPerson({ recordTypeValueId: 2 }), ids)).toBe(false);
    expect(linkable(rockPerson({ isDeceased: true }), ids)).toBe(false);
    expect(linkable(rockPerson({ recordStatusValueId: 4 }), ids)).toBe(false);
  });
});

describe("rockProvider", () => {
  it("maps a Rock person to a records person with a string id", () => {
    expect(toRecordsPerson(rockPerson(), ids)).toEqual({
      id: "100",
      firstName: "Margaret",
      nickName: "Peggy",
      lastName: "O'Brien",
      email: "obriens@example.org",
      birthMonth: 4,
      birthDay: 12,
      birthYear: 1961,
      linkable: true,
    });
  });

  it("asks Rock only for ids that can be Rock ids, and marks who can't be linked", async () => {
    client.peopleByIds.mockResolvedValue([rockPerson({ isDeceased: true })]);
    const people = await rockProvider.findByIds(creds, ["100", "abc", "0", "-5"]);
    expect(client.peopleByIds).toHaveBeenCalledWith(creds, [100]);
    expect(people).toEqual([expect.objectContaining({ id: "100", linkable: false })]);
  });

  it("finds people by last name and reports cut-short names normalized", async () => {
    client.peopleByLastName.mockResolvedValue({ people: [rockPerson()], truncated: ["O'Brien"] });
    const found = await rockProvider.findByLastNames(creds, ["O'Brien"]);
    expect(found.people).toEqual([expect.objectContaining({ id: "100", linkable: true })]);
    expect([...found.incompleteLastNames]).toEqual(["obrien"]);
  });

  it("makes no request for a list with no Rock ids", async () => {
    expect(await rockProvider.findByIds(creds, ["abc"])).toEqual([]);
    expect(client.peopleByIds).not.toHaveBeenCalled();
  });

  it("opens a person on Rock's person page", () => {
    expect(rockProvider.personUrl("https://rock.example.org", "100")).toBe("https://rock.example.org/Person/100");
  });
});
