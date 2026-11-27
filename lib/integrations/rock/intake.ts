// Sending a new person to a church's Rock: two42 starts the workflow type the
// church picked, with the person's name, email and phone as its attribute
// values, for the church's staff to review. It never creates or changes a
// Person, and never files a connection request, which needs a Person already.
//
// These calls use the write key alone; the read key and its controllers never
// come here.
import type { RecordsIntake, RecordsIntakeDestination, RecordsNewPerson } from "@/lib/integrations/records/types";
import { RecordsError } from "@/lib/integrations/records/errors";
import { safeFetch } from "@/lib/integrations/records/safeFetch";
import type { RecordsCredentials } from "@/supabase/functions/_shared/records-types";
import type { FetchLike } from "@/supabase/functions/_shared/rock-client";

/** The keys of the workflow type's attributes, which the setup docs tell the church to give it. */
export const ROCK_INTAKE_ATTRIBUTES = {
  firstName: "FirstName",
  lastName: "LastName",
  email: "Email",
  phone: "Phone",
} as const;

type WritePath = "/api/WorkflowTypes" | `/api/Workflows/WorkflowEntry/${number}`;

const TIMEOUT_MS = 10_000;
const ROCK_ID = /^[1-9][0-9]{0,9}$/;

/** The parsed JSON, or null for an empty or non-JSON answer. Never puts the address or the answer in an error. */
async function writeRequest(
  creds: RecordsCredentials,
  method: "GET" | "POST",
  path: WritePath,
  query: Record<string, string>,
  fetcher: FetchLike,
): Promise<unknown> {
  const url = new URL(path, creds.baseUrl);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  let response: Response;
  try {
    response = await fetcher(url, {
      method,
      headers: { "Authorization-Token": creds.key, Accept: "application/json" },
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new RecordsError("unreachable");
  }
  if (response.status === 401 || response.status === 403) throw new RecordsError("unauthorized", response.status);
  if (!response.ok) throw new RecordsError("rejected", response.status);
  try {
    const text = await response.text();
    return text ? (JSON.parse(text) as unknown) : null;
  } catch {
    return null;
  }
}

function workflowType(value: unknown): (RecordsIntakeDestination & { active: boolean }) | null {
  if (typeof value !== "object" || value === null) return null;
  const { Id, Name, IsActive } = value as Record<string, unknown>;
  if (typeof Id !== "number" || !Number.isInteger(Id) || Id <= 0) return null;
  const name = typeof Name === "string" ? Name.trim() : "";
  if (!name) return null;
  // Rock's IsActive is nullable, and null means active.
  return { id: String(Id), name: name.slice(0, 200), active: IsActive !== false };
}

async function workflowTypes(creds: RecordsCredentials, query: Record<string, string>, fetcher: FetchLike) {
  const body = await writeRequest(creds, "GET", "/api/WorkflowTypes", { $select: "Id,Name,IsActive", ...query }, fetcher);
  if (!Array.isArray(body)) throw new RecordsError("not_provider");
  return body.map(workflowType).filter((type) => type !== null);
}

const entryPath = (id: string): WritePath => `/api/Workflows/WorkflowEntry/${Number(id)}`;

export function rockIntake(fetcher: FetchLike = safeFetch): Omit<RecordsIntake, "setup"> {
  return {
    parseDestinationId(value) {
      const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
      return ROCK_ID.test(text) ? text : null;
    },

    async destinations(creds) {
      const types = await workflowTypes(creds, { $orderby: "Name", $top: "500" }, fetcher);
      return types.filter((type) => type.active).map(({ id, name }) => ({ id, name }));
    },

    async checkDestination(creds, id) {
      const [type] = await workflowTypes(creds, { $filter: `Id eq ${Number(id)}` }, fetcher);
      if (!type || type.id !== id || !type.active) throw new RecordsError("not_found");
      // Rock checks the key's permission on the action before it looks up the
      // type, and starts nothing for an id no type has, so this proves the
      // permission without sending anyone.
      await writeRequest(creds, "POST", entryPath("0"), {}, fetcher);
      return { id: type.id, name: type.name };
    },

    async submitNewPerson(creds, id, person: RecordsNewPerson) {
      const query: Record<string, string> = {
        [ROCK_INTAKE_ATTRIBUTES.firstName]: person.firstName,
        [ROCK_INTAKE_ATTRIBUTES.lastName]: person.lastName,
        [ROCK_INTAKE_ATTRIBUTES.email]: person.email,
      };
      if (person.phone) query[ROCK_INTAKE_ATTRIBUTES.phone] = person.phone;
      const body = await writeRequest(creds, "POST", entryPath(id), query, fetcher);
      // Rock answers an id with no active workflow type with an empty answer and starts nothing.
      if (typeof body !== "object" || body === null || Array.isArray(body)) throw new RecordsError("not_found");
    },
  };
}
