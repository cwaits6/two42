import { describe, expect, it, vi } from "vitest";
import { RecordsError } from "@/lib/integrations/records/errors";
import { checkConnection, definedValueIds, lastNameVariants, odataString, peopleByIds, peopleByLastName } from "./client";

const creds = { baseUrl: "https://rock.example.org", key: "secret-key-123" };

function reply(body: unknown, init: { status?: number; type?: string } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": init.type ?? "application/json; charset=utf-8" },
  });
}

describe("Rock client", () => {
  it("sends the key in Authorization-Token, refuses redirects, and only GETs", async () => {
    const fetcher = vi.fn().mockResolvedValue(reply([{ Id: 1 }]));
    await checkConnection(creds, fetcher);
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toMatch(/^https:\/\/rock\.example\.org\/api\/People\?/);
    expect(String(url)).not.toContain("secret-key-123");
    expect(init).toMatchObject({ method: "GET", redirect: "error" });
    expect(init.headers["Authorization-Token"]).toBe("secret-key-123");
  });

  it.each([
    [reply({ Message: "Authorization has been denied" }, { status: 401 }), "unauthorized"],
    [reply("oops", { status: 500 }), "rejected"],
    [reply("<html>", { type: "text/html" }), "not_provider"],
    [reply({ not: "an array" }), "not_provider"],
  ])("reports a failure by kind", async (response, kind) => {
    const fetcher = vi.fn().mockResolvedValue(response);
    await expect(checkConnection(creds, fetcher)).rejects.toMatchObject({ kind });
  });

  it("reports an unreachable host", async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    await expect(checkConnection(creds, fetcher)).rejects.toBeInstanceOf(RecordsError);
  });

  it("escapes quotes in OData strings", () => {
    expect(odataString("O'Brien")).toBe("'O''Brien'");
  });

  it("looks up the install's defined value ids by Guid", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      reply([
        { Id: 1, Guid: "36CF10D6-C695-413D-8E7C-4546EFEF385E" },
        { Id: 4, Guid: "1DAD99D5-41A9-4865-8366-F269902B80A4" },
      ]),
    );
    expect(await definedValueIds(creds, fetcher)).toEqual({ recordTypePerson: 1, recordStatusInactive: 4 });
  });

  it("filters people by last name to living, active person records and asks only for matching fields", async () => {
    const fetcher = vi.fn().mockResolvedValue(reply([{ Id: 7, FirstName: "Ann", LastName: "O'Brien" }]));
    const { people, truncated } = await peopleByLastName(
      creds,
      { recordTypePerson: 1, recordStatusInactive: 4 },
      ["O'Brien"],
      fetcher,
    );
    expect(people.map((p) => p.id)).toEqual([7]);
    expect(truncated).toEqual([]);
    const url = new URL(String(fetcher.mock.calls[0][0]));
    expect(url.searchParams.get("$filter")).toBe(
      "(LastName eq 'O''Brien' or LastName eq 'OBrien') and IsDeceased eq false and RecordTypeValueId eq 1 and RecordStatusValueId ne 4",
    );
    expect(url.searchParams.get("$select")).not.toMatch(/Phone|Address|Family/);
  });

  it.each([
    ["O'Brien", ["O'Brien", "OBrien"]],
    ["OBrien", ["OBrien", "O'Brien"]],
    ["Smith-Jones", ["Smith-Jones", "SmithJones", "Smith Jones"]],
    ["Van Dyke", ["Van Dyke", "VanDyke", "Van-Dyke"]],
    ["Lee", ["Lee"]],
  ])("asks Rock for the spellings of %s that matching treats as equal", (name, variants) => {
    expect(lastNameVariants(name)).toEqual(variants);
  });

  it("reports last names whose batch had more people than it reads", async () => {
    const page = Array.from({ length: 500 }, (_, i) => ({ Id: i + 1, LastName: "Smith" }));
    const fetcher = vi.fn().mockImplementation(async () => reply(page));
    const { truncated } = await peopleByLastName(creds, { recordTypePerson: 1, recordStatusInactive: 4 }, ["Smith"], fetcher);
    expect(truncated).toEqual(["Smith"]);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("keeps only the ids it asked for", async () => {
    const fetcher = vi.fn().mockResolvedValue(reply([{ Id: 7 }, { Id: 99 }]));
    expect((await peopleByIds(creds, [7], fetcher)).map((p) => p.id)).toEqual([7]);
  });
});
