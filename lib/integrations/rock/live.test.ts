import { describe, expect, it } from "vitest";
import { RecordsError } from "@/lib/integrations/records/errors";
import { LIVE_PERSON_FIELDS, rockLiveSource } from "./live";

const creds = { baseUrl: "https://rock.example.org", key: "secret-key-123" };
const HOME_TYPE = 19;

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function idsIn(url: URL): number[] {
  return [...(url.searchParams.get("$filter") ?? "").matchAll(/Id eq (\d+)/g)].map((m) => Number(m[1]));
}

/** A Rock that knows every person and family it's asked for, recording each request. */
function fakeRock() {
  const requests: URL[] = [];
  const fetcher = async (url: URL) => {
    requests.push(url);
    if (url.pathname === "/api/DefinedValues") return reply([{ Id: HOME_TYPE, Guid: "8c52e53c-2a66-435a-ae6e-5ee307d9a0dc" }]);
    if (url.pathname === "/api/People") {
      return reply(
        idsIn(url).map((id) => ({
          Id: id,
          BirthMonth: 4,
          BirthDay: 12,
          AnniversaryDate: "2001-06-09T00:00:00",
          GraduationYear: 2031,
        })),
      );
    }
    if (url.pathname === "/api/Groups") {
      return reply(
        idsIn(url).map((id) => ({
          Id: id,
          GroupLocations: [{ LocationId: id + 10_000, GroupLocationTypeValueId: HOME_TYPE, IsMailingLocation: true }],
        })),
      );
    }
    if (url.pathname === "/api/Locations") {
      return reply(
        idsIn(url).map((id) => ({
          Id: id,
          Street1: `${id} Oak St`,
          Street2: "",
          City: "Austin",
          State: "TX",
          PostalCode: "78701",
          Country: "US",
        })),
      );
    }
    return reply([], 404);
  };
  return { requests, fetcher };
}

const range = (from: number, count: number) => Array.from({ length: count }, (_, i) => String(from + i));

describe("Rock live details", () => {
  it("reads only the people and families asked for, with only the fields shown live and never a birth year", async () => {
    const { requests, fetcher } = fakeRock();
    const found = await rockLiveSource(fetcher).details(creds, { people: ["100", "101"], families: ["500"] });

    expect([...found.people!.keys()].sort()).toEqual(["100", "101"]);
    expect(found.people!.get("100")).toEqual({
      birthday: { month: 4, day: 12 },
      anniversary: { year: 2001, month: 6, day: 9 },
      graduationYear: 2031,
    });
    expect(found.families!.get("500")).toMatchObject({ street1: "10500 Oak St", city: "Austin" });

    const people = requests.filter((u) => u.pathname === "/api/People");
    expect(people.map((u) => u.searchParams.get("$select"))).toEqual([LIVE_PERSON_FIELDS.join(",")]);
    expect(requests.map((u) => u.search).join(" ")).not.toContain("BirthYear");
    expect(people.flatMap(idsIn).sort()).toEqual([100, 101]);
    expect(requests.filter((u) => u.pathname === "/api/Groups").flatMap(idsIn)).toEqual([500]);
  });

  it.each([
    [120, 0, 3],
    [200, 80, 4 + 1 + 2 + 2],
  ])("asks for %i people and %i families in %i requests", async (people, families, expected) => {
    const { requests, fetcher } = fakeRock();
    await rockLiveSource(fetcher).details(creds, { people: range(100, people), families: range(5000, families) });
    expect(requests).toHaveLength(expected);
  });

  it("sends nothing when there is no one to ask for, and leaves out ids that aren't Rock's", async () => {
    const { requests, fetcher } = fakeRock();
    const found = await rockLiveSource(fetcher).details(creds, { people: ["not-a-rock-id"], families: [] });
    expect(requests).toHaveLength(0);
    expect(found.people!.size).toBe(0);
  });

  it("leaves out a person the records don't have", async () => {
    const fetcher = async (url: URL) => (url.pathname === "/api/People" ? reply([{ Id: 100 }]) : reply([]));
    const found = await rockLiveSource(fetcher).details(creds, { people: ["100", "101"], families: [] });
    expect([...found.people!.keys()]).toEqual(["100"]);
    expect(found.people!.get("100")).toEqual({
      birthday: { month: null, day: null },
      anniversary: { year: null, month: null, day: null },
      graduationYear: null,
    });
  });

  it("still answers the people when only the families can't be read, saying why", async () => {
    const { fetcher: rock } = fakeRock();
    const fetcher = async (url: URL) =>
      url.pathname === "/api/Groups" ? reply({ Message: "Authorization has been denied" }, 401) : rock(url);
    const found = await rockLiveSource(fetcher).details(creds, { people: ["100"], families: ["500"] });
    expect([...found.people!.keys()]).toEqual(["100"]);
    expect(found.families).toBeNull();
    expect(found.error).toBeInstanceOf(RecordsError);
  });

  it("fails with a records error when Rock can't answer", async () => {
    const fetcher = async () => reply({ Message: "Authorization has been denied" }, 401);
    await expect(rockLiveSource(fetcher).details(creds, { people: ["100"], families: [] })).rejects.toBeInstanceOf(
      RecordsError,
    );
  });
});
