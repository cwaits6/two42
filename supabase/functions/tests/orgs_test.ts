// Unit tests for the org-iteration primitive. Pure units: no network, no
// database — the fake below satisfies OrgListClient structurally.

import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  forEachOrg,
  listActiveOrgs,
  OrgRunError,
  summarize,
  type Org,
  type OrgListClient,
  type OrgRunResult,
} from "../_shared/orgs.ts";

interface RecordedQuery {
  from?: string;
  select?: string;
  eq?: [string, unknown];
  order?: string;
}

function makeFakeClient(result: {
  data: Org[] | null;
  error: { message: string } | null;
}): { client: OrgListClient; recorded: RecordedQuery } {
  const recorded: RecordedQuery = {};
  const client: OrgListClient = {
    from(table) {
      recorded.from = table;
      return {
        select(columns) {
          recorded.select = columns;
          return {
            eq(column, value) {
              recorded.eq = [column, value];
              return {
                order(column) {
                  recorded.order = column;
                  return Promise.resolve(result);
                },
              };
            },
          };
        },
      };
    },
  };
  return { client, recorded };
}

// branding is carried opaquely (unknown): one populated row, one empty
// object, one null — listActiveOrgs and forEachOrg must not care which.
// org_email_domains is carried the same way: one populated embed, two empty
// (PostgREST returns [] for an org with no claimed domain) — interpretation
// is _shared/branding.ts's job, tested in branding_test.ts. org_domains
// likewise: one populated embed, two empty — _shared/org-urls.ts interprets
// it, tested in org-urls_test.ts.
const orgA: Org = {
  id: "a-id",
  name: "Org A",
  slug: "a",
  branding: { display_name: "Org A Fellowship", accent: "#2E6F5E" },
  org_email_domains: [{ domain: "org-a.example", status: "verified" }],
  org_domains: [{ domain: "org-a.example", status: "verified", attached_at: "2026-09-01T00:00:00Z" }],
};
const orgB: Org = {
  id: "b-id",
  name: "Org B",
  slug: "b",
  branding: {},
  org_email_domains: [],
  org_domains: [],
};
const orgC: Org = {
  id: "c-id",
  name: "Org C",
  slug: "c",
  branding: null,
  org_email_domains: [],
  org_domains: [],
};

Deno.test("listActiveOrgs filters on status = active and orders by slug", async () => {
  const { client, recorded } = makeFakeClient({ data: [orgA, orgB], error: null });
  const orgs = await listActiveOrgs(client);
  assertEquals(recorded.from, "organizations");
  assertEquals(
    recorded.select,
    "id, name, slug, branding, org_email_domains(domain, status), org_domains(domain, status, attached_at)",
  );
  assertEquals(recorded.eq, ["status", "active"]);
  assertEquals(recorded.order, "slug");
  assertEquals(orgs, [orgA, orgB]);
});

Deno.test("listActiveOrgs throws when the query errors", async () => {
  const { client } = makeFakeClient({ data: null, error: { message: "boom" } });
  await assertRejects(
    () => listActiveOrgs(client),
    Error,
    "Failed to list organizations: boom",
  );
});

Deno.test("listActiveOrgs returns [] when data is null and there is no error", async () => {
  const { client } = makeFakeClient({ data: null, error: null });
  assertEquals(await listActiveOrgs(client), []);
});

Deno.test("forEachOrg runs every org and totals the counts", async () => {
  const seen: string[] = [];
  const results = await forEachOrg([orgA, orgB, orgC], (org) => {
    seen.push(org.slug);
    return Promise.resolve({ sent: seen.length * 10, sendFailures: seen.length });
  });
  assertEquals(seen, ["a", "b", "c"]);
  assertEquals(results, [
    { orgId: "a-id", slug: "a", sent: 10, sendFailures: 1 },
    { orgId: "b-id", slug: "b", sent: 20, sendFailures: 2 },
    { orgId: "c-id", slug: "c", sent: 30, sendFailures: 3 },
  ]);
});

// Sequential iteration is the sole throttle on outbound Resend concurrency —
// the module comment makes it load-bearing. Asserting on call order alone
// cannot catch a regression: Promise.all(orgs.map(fn)) preserves both the
// `seen` order and the result order. An in-flight counter is what distinguishes
// them, and it also catches a bounded-concurrency pool, not just full fan-out.
Deno.test("forEachOrg runs orgs sequentially, never overlapping", async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  await forEachOrg([orgA, orgB, orgC], async () => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    return { sent: 1, sendFailures: 0 };
  });
  assertEquals(maxInFlight, 1, "orgs must not overlap");
});

Deno.test("forEachOrg continues after one org throws", async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    const seen: string[] = [];
    const results = await forEachOrg([orgA, orgB, orgC], (org) => {
      seen.push(org.slug);
      if (org.slug === "b") return Promise.reject(new Error("org b exploded"));
      return Promise.resolve({ sent: 1, sendFailures: 0 });
    });
    assertEquals(seen, ["a", "b", "c"]);
    assertEquals(results[0], { orgId: "a-id", slug: "a", sent: 1, sendFailures: 0 });
    assertEquals(results[1], {
      orgId: "b-id",
      slug: "b",
      sent: 0,
      sendFailures: 0,
      error: "org b exploded",
    });
    assertEquals(results[2], { orgId: "c-id", slug: "c", sent: 1, sendFailures: 0 });
  } finally {
    console.error = originalError;
  }
});

// A mid-run throw after partial sends must not be reported as
// "nothing sent" — OrgRunError carries the counts accumulated before the
// abort, and forEachOrg must use them instead of zeroing.
Deno.test("forEachOrg uses the accumulated counts from an OrgRunError instead of zeroing them", async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    const results = await forEachOrg([orgA, orgB], (org) => {
      if (org.slug === "a") {
        return Promise.reject(new OrgRunError("org a exploded mid-run", { sent: 7, sendFailures: 2 }));
      }
      return Promise.resolve({ sent: 3, sendFailures: 0 });
    });
    assertEquals(results[0], {
      orgId: "a-id",
      slug: "a",
      sent: 7,
      sendFailures: 2,
      error: "org a exploded mid-run",
    });
    assertEquals(results[1], { orgId: "b-id", slug: "b", sent: 3, sendFailures: 0 });
  } finally {
    console.error = originalError;
  }
});

Deno.test("forEachOrg records non-Error throws", async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    const results = await forEachOrg([orgA], () => Promise.reject("plain string"));
    assertEquals(results, [
      { orgId: "a-id", slug: "a", sent: 0, sendFailures: 0, error: "plain string" },
    ]);
  } finally {
    console.error = originalError;
  }
});

Deno.test("forEachOrg returns [] for no orgs", async () => {
  assertEquals(await forEachOrg([], () => Promise.resolve({ sent: 1, sendFailures: 0 })), []);
});

Deno.test("summarize totals sends and lists failures by slug", () => {
  const results: OrgRunResult[] = [
    { orgId: "a-id", slug: "a", sent: 5, sendFailures: 0 },
    { orgId: "b-id", slug: "b", sent: 0, sendFailures: 0, error: "org b exploded" },
    { orgId: "c-id", slug: "c", sent: 7, sendFailures: 0 },
  ];
  assertEquals(summarize(results), {
    orgs: 3,
    emailsSent: 12,
    emailsFailed: 0,
    failed: [{ org: "b", error: "org b exploded" }],
    failedItems: [],
  });
});

// A run in which Resend rejected every email must not be reportable as a quiet
// day: no send failure throws, so without emailsFailed the body is identical to
// "nobody had a reminder due".
Deno.test("summarize counts send failures separately from thrown org failures", () => {
  const results: OrgRunResult[] = [
    { orgId: "a-id", slug: "a", sent: 0, sendFailures: 12 },
    { orgId: "b-id", slug: "b", sent: 0, sendFailures: 5 },
  ];
  assertEquals(summarize(results), {
    orgs: 2,
    emailsSent: 0,
    emailsFailed: 17,
    failed: [],
    failedItems: [],
  });
});

Deno.test("summarize reports every org failing without throwing", () => {
  const results: OrgRunResult[] = [
    { orgId: "a-id", slug: "a", sent: 0, sendFailures: 0, error: "a died" },
    { orgId: "b-id", slug: "b", sent: 0, sendFailures: 0, error: "b died" },
  ];
  assertEquals(summarize(results), {
    orgs: 2,
    emailsSent: 0,
    emailsFailed: 0,
    failed: [
      { org: "a", error: "a died" },
      { org: "b", error: "b died" },
    ],
    failedItems: [],
  });
});

Deno.test("summarize returns zeroed totals for no orgs", () => {
  assertEquals(summarize([]), {
    orgs: 0,
    emailsSent: 0,
    emailsFailed: 0,
    failed: [],
    failedItems: [],
  });
});

// ── The sub-org failure channel ──────────────────────────────────────────────

Deno.test("forEachOrg propagates itemFailures from a successful return", async () => {
  const failures = [{ item: "team-1", error: "team 1 exploded" }];
  const results = await forEachOrg([orgA], () =>
    Promise.resolve({ sent: 4, sendFailures: 1, itemFailures: failures }));
  assertEquals(results, [
    { orgId: "a-id", slug: "a", sent: 4, sendFailures: 1, itemFailures: failures },
  ]);
});

Deno.test("forEachOrg omits itemFailures when a runner returns an empty list", async () => {
  const results = await forEachOrg([orgA], () =>
    Promise.resolve({ sent: 2, sendFailures: 0, itemFailures: [] }));
  // Exact shape: no itemFailures key — runners without item failures keep
  // today's result shape and response body.
  assertEquals(results, [{ orgId: "a-id", slug: "a", sent: 2, sendFailures: 0 }]);
});

// Both channels together: an org that aborts mid-run must still report both its
// partial counts AND the teams that had already failed before the abort.
Deno.test("forEachOrg propagates itemFailures carried by an OrgRunError", async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    const results = await forEachOrg([orgA, orgB], (org) => {
      if (org.slug === "a") {
        return Promise.reject(
          new OrgRunError("org a exploded mid-run", {
            sent: 7,
            sendFailures: 2,
            itemFailures: [{ item: "team-1", error: "team 1 exploded" }],
          }),
        );
      }
      return Promise.resolve({ sent: 3, sendFailures: 0 });
    });
    assertEquals(results[0], {
      orgId: "a-id",
      slug: "a",
      sent: 7,
      sendFailures: 2,
      itemFailures: [{ item: "team-1", error: "team 1 exploded" }],
      error: "org a exploded mid-run",
    });
    assertEquals(results[1], { orgId: "b-id", slug: "b", sent: 3, sendFailures: 0 });
  } finally {
    console.error = originalError;
  }
});

Deno.test("summarize flattens itemFailures into failedItems stamped with the org slug", () => {
  const results: OrgRunResult[] = [
    {
      orgId: "a-id",
      slug: "a",
      sent: 5,
      sendFailures: 1,
      itemFailures: [
        { item: "team-1", error: "team 1 exploded" },
        { item: "team-2", error: "team 2 exploded" },
      ],
    },
    { orgId: "b-id", slug: "b", sent: 4, sendFailures: 0 },
    {
      orgId: "c-id",
      slug: "c",
      sent: 2,
      sendFailures: 0,
      itemFailures: [{ item: "team-9", error: "team 9 exploded" }],
      error: "org c exploded mid-run",
    },
  ];
  assertEquals(summarize(results), {
    orgs: 3,
    emailsSent: 11,
    emailsFailed: 1,
    failed: [{ org: "c", error: "org c exploded mid-run" }],
    failedItems: [
      { org: "a", item: "team-1", error: "team 1 exploded" },
      { org: "a", item: "team-2", error: "team 2 exploded" },
      { org: "c", item: "team-9", error: "team 9 exploded" },
    ],
  });
});
