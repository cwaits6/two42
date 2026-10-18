// Unit tests for group enumeration and per-group link mode. Pure units: no
// network, no database — the fake below satisfies GroupClient structurally.

import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { listGroups, resolveGroupLinkMode, type GroupClient } from "../_shared/groups.ts";

const ORG = "11111111-2222-3333-4444-555555555555";
const GROUP = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

interface RecordedQuery {
  from?: string;
  select?: string;
  eq: Array<[string, unknown]>;
  order?: string;
  maybeSingle?: boolean;
}

function makeFakeClient(result: {
  data: unknown;
  error: { message: string } | null;
}): { client: GroupClient; recorded: RecordedQuery } {
  const recorded: RecordedQuery = { eq: [] };
  const client = {
    from(table: string) {
      recorded.from = table;
      return {
        select(columns: string) {
          recorded.select = columns;
          return {
            eq(column: string, value: unknown) {
              recorded.eq.push([column, value]);
              return {
                order(column: string) {
                  recorded.order = column;
                  return Promise.resolve(result);
                },
                eq(column: string, value: unknown) {
                  recorded.eq.push([column, value]);
                  return {
                    maybeSingle() {
                      recorded.maybeSingle = true;
                      return Promise.resolve(result);
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  } as unknown as GroupClient;
  return { client, recorded };
}

Deno.test("listGroups filters on org_id and orders by name", async () => {
  const groups = [{ id: "g1", name: "Alpha" }, { id: "g2", name: "Beta" }];
  const { client, recorded } = makeFakeClient({ data: groups, error: null });
  assertEquals(await listGroups(client, ORG), groups);
  assertEquals(recorded.from, "groups");
  assertEquals(recorded.select, "id, name");
  assertEquals(recorded.eq, [["org_id", ORG]]);
  assertEquals(recorded.order, "name");
});

Deno.test("listGroups returns [] when data is null and there is no error", async () => {
  const { client } = makeFakeClient({ data: null, error: null });
  assertEquals(await listGroups(client, ORG), []);
});

Deno.test("listGroups throws when the query errors", async () => {
  const { client } = makeFakeClient({ data: null, error: { message: "boom" } });
  await assertRejects(() => listGroups(client, ORG), Error, "groups query failed: boom");
});

Deno.test("resolveGroupLinkMode reads the group's row scoped by org and group", async () => {
  const { client, recorded } = makeFakeClient({ data: { serving_link_mode: "login" }, error: null });
  assertEquals(await resolveGroupLinkMode(client, ORG, GROUP, "signed"), "login");
  assertEquals(recorded.from, "group_settings");
  assertEquals(recorded.select, "serving_link_mode");
  assertEquals(recorded.eq, [["org_id", ORG], ["group_id", GROUP]]);
  assertEquals(recorded.maybeSingle, true);
});

Deno.test("resolveGroupLinkMode falls back to the env default for a group with no row", async () => {
  const { client } = makeFakeClient({ data: null, error: null });
  assertEquals(await resolveGroupLinkMode(client, ORG, GROUP, "login"), "login");
  assertEquals(await resolveGroupLinkMode(client, ORG, GROUP, "signed"), "signed");
  // Anything that is not exactly "login" normalises to signed.
  assertEquals(await resolveGroupLinkMode(client, ORG, GROUP, "bogus"), "signed");
});

Deno.test("resolveGroupLinkMode throws when the query errors", async () => {
  const { client } = makeFakeClient({ data: null, error: { message: "boom" } });
  await assertRejects(
    () => resolveGroupLinkMode(client, ORG, GROUP, "signed"),
    Error,
    "group_settings query failed: boom",
  );
});
