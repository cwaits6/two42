import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { RecordsError } from "@/lib/integrations/records/errors";
import { ROCK_INTAKE_ATTRIBUTES, rockIntake } from "./intake";

const creds = { baseUrl: "https://rock.example.org", key: "write-key-1234" };
const person = { firstName: "Nora", lastName: "Setupwell", email: "nora@example.test", phone: "(555) 123-4567" };

type Answer = { status?: number; body?: unknown } | Error;

/** A fetcher that answers in turn and records every request; nothing reaches a network. */
function stub(...answers: Answer[]) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const fetcher = vi.fn(async (url: URL, init: RequestInit) => {
    calls.push({ url, init });
    const answer = answers.shift() ?? { body: null };
    if (answer instanceof Error) throw answer;
    const text = answer.body === undefined ? "" : JSON.stringify(answer.body);
    return new Response(text, { status: answer.status ?? 200, headers: { "content-type": "application/json" } });
  });
  return { intake: rockIntake(fetcher), calls };
}

async function kind(promise: Promise<unknown>) {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(RecordsError);
  return (err as RecordsError).kind;
}

describe("rockIntake().submitNewPerson", () => {
  it("starts the chosen workflow type with only the name, email and phone, and no body", async () => {
    const { intake, calls } = stub({ body: { Id: 5501 } });
    await intake.submitNewPerson(creds, "42", person);
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0];
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
    expect(url.origin + url.pathname).toBe("https://rock.example.org/api/Workflows/WorkflowEntry/42");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      FirstName: "Nora",
      LastName: "Setupwell",
      Email: "nora@example.test",
      Phone: "(555) 123-4567",
    });
    expect(new Headers(init.headers).get("Authorization-Token")).toBe("write-key-1234");
  });

  it("leaves the phone out when the person has none", async () => {
    const { intake, calls } = stub({ body: { Id: 0 } });
    await intake.submitNewPerson(creds, "42", { ...person, phone: null });
    expect([...calls[0].url.searchParams.keys()]).toEqual(["FirstName", "LastName", "Email"]);
  });

  it.each([
    [{ status: 401 }, "unauthorized"],
    [{ status: 403 }, "unauthorized"],
    [{ status: 500 }, "rejected"],
    [{ body: null }, "not_found"],
    [{}, "not_found"],
    [new TypeError("fetch failed"), "unreachable"],
  ] as const)("answers %j with %s", async (answer, expected) => {
    const { intake } = stub(answer);
    expect(await kind(intake.submitNewPerson(creds, "42", person))).toBe(expected);
  });
});

describe("rockIntake().checkDestination", () => {
  it("reads the type through the write key, then proves the start permission on an id no type has", async () => {
    const { intake, calls } = stub({ body: [{ Id: 42, Name: "New from two42", IsActive: null }] }, { body: null });
    expect(await intake.checkDestination(creds, "42")).toEqual({ id: "42", name: "New from two42" });
    expect(calls[0].init.method).toBe("GET");
    expect(calls[0].url.pathname).toBe("/api/WorkflowTypes");
    expect(calls[0].url.searchParams.get("$filter")).toBe("Id eq 42");
    expect(calls[1].init.method).toBe("POST");
    expect(calls[1].url.pathname).toBe("/api/Workflows/WorkflowEntry/0");
    expect([...calls[1].url.searchParams.keys()]).toEqual([]);
  });

  it("refuses a missing or inactive type without trying to start anything", async () => {
    for (const body of [[], [{ Id: 42, Name: "Old intake", IsActive: false }]]) {
      const { intake, calls } = stub({ body });
      expect(await kind(intake.checkDestination(creds, "42"))).toBe("not_found");
      expect(calls).toHaveLength(1);
    }
  });

  it("names a missing permission on either request", async () => {
    expect(await kind(stub({ status: 401 }).intake.checkDestination(creds, "42"))).toBe("unauthorized");
    const missingStart = stub({ body: [{ Id: 42, Name: "New from two42" }] }, { status: 401 });
    expect(await kind(missingStart.intake.checkDestination(creds, "42"))).toBe("unauthorized");
  });
});

describe("rockIntake().destinations", () => {
  it("lists the active types and leaves out the rest", async () => {
    const { intake } = stub({
      body: [
        { Id: 42, Name: "New from two42", IsActive: true },
        { Id: 43, Name: "Old intake", IsActive: false },
        { Id: 44, Name: "Visitor follow-up" },
        { Id: "x", Name: "Not a type" },
      ],
    });
    expect(await intake.destinations(creds)).toEqual([
      { id: "42", name: "New from two42" },
      { id: "44", name: "Visitor follow-up" },
    ]);
  });

  it("reads every page, so an active type past the first page still appears", async () => {
    const inactive = Array.from({ length: 500 }, (_, i) => ({ Id: i + 1, Name: `Old ${i}`, IsActive: false }));
    const { intake, calls } = stub({ body: inactive }, { body: [{ Id: 900, Name: "New from two42" }] });
    expect(await intake.destinations(creds)).toEqual([{ id: "900", name: "New from two42" }]);
    expect(calls.map(({ url }) => [url.searchParams.get("$orderby"), url.searchParams.get("$skip")])).toEqual([
      ["Name,Id", "0"],
      ["Name,Id", "500"],
    ]);
  });

  it("refuses an answer that isn't a list", async () => {
    expect(await kind(stub({ body: { Message: "hi" } }).intake.destinations(creds))).toBe("not_provider");
  });
});

describe("rockIntake().parseDestinationId", () => {
  it("takes a positive whole number and nothing else", () => {
    const { intake } = stub();
    expect(intake.parseDestinationId("42")).toBe("42");
    expect(intake.parseDestinationId(42)).toBe("42");
    for (const value of ["0", "-1", "abc", "1e3", "", null, 4.2]) expect(intake.parseDestinationId(value)).toBeNull();
  });
});

describe("the setup docs", () => {
  const keys: string[] = Object.values(ROCK_INTAKE_ATTRIBUTES);
  const list = (quote: string) =>
    `${keys.slice(0, -1).map((k) => `${quote}${k}${quote}`).join(", ")} and ${quote}${keys.at(-1)}${quote}`;

  it.each([
    ["docs/integrations/church-records.md", "`"],
    ["docs-site/content/docs/administer/church-records.mdx", ""],
  ])("%s name the attribute keys and REST controllers two42 uses", (path, quote) => {
    const text = readFileSync(path, "utf8").replace(/\s+/g, " ");
    expect(text).toContain(list(quote));
    for (const controller of ["WorkflowEntry", "Workflows", "WorkflowTypes"]) expect(text).toContain(controller);
  });
});
