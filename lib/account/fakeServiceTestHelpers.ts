// An in-memory stand-in for the service client that honours the filters a chain
// actually carries, so a dropped org filter changes the result and fails a test.

type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;
export interface Failure {
  table: string;
  op: "select" | "update" | "delete";
  // Let this many matching calls through first, to fail a later one in the same run.
  skip?: number;
}

type LikeToken = { any: true } | { one: true } | { literal: string };

function likeTokens(pattern: string) {
  const tokens: LikeToken[] = [];
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    const next = pattern[i + 1];
    if (char === "\\" && next !== undefined && "\\%_".includes(next)) {
      tokens.push({ literal: next });
      i++;
    } else if (char === "%" || char === "*") tokens.push({ any: true });
    else if (char === "_") tokens.push({ one: true });
    else tokens.push({ literal: char });
  }
  return tokens;
}

// What PostgREST does with a pattern: `*` and `%` match any run, `_` one character.
function ilikeMatches(value: unknown, pattern: string) {
  if (typeof value !== "string") return false;
  const text = value.toLowerCase();
  // Every offset in the text that the tokens read so far can end at.
  let ends = new Set([0]);
  for (const token of likeTokens(pattern.toLowerCase())) {
    const next = new Set<number>();
    if ("any" in token) {
      const from = Math.min(...ends);
      for (let end = from; end <= text.length; end++) next.add(end);
    } else {
      for (const end of ends) {
        if (end < text.length && ("one" in token || text[end] === token.literal)) next.add(end + 1);
      }
    }
    ends = next;
  }
  return ends.has(text.length);
}

export function fakeService(tables: Tables) {
  const failures: Failure[] = [];
  const log = {
    writes: [] as { table: string; op: string; filters: string[] }[],
    deletedUsers: [] as string[],
    removedObjects: [] as string[],
  };
  const state = {
    deleteUserError: null as { code: string } | null,
    getUserError: null as { code: string } | null,
    // The sign-in address when it differs from the one on the profile.
    authEmail: null as string | null,
    storageError: null as { message: string } | null,
    // What the auth cascade does to the profile; off proves the check after it.
    cascade: true,
    onDeleteUser: null as (() => void) | null,
  };

  function from(table: string) {
    const predicates: ((row: Row) => boolean)[] = [];
    const filters: string[] = [];
    let op: Failure["op"] = "select";
    let patch: Row = {};
    let limit = Infinity;

    const builder = {
      select: () => builder,
      order: () => builder,
      limit: (n: number) => {
        limit = n;
        return builder;
      },
      update: (values: Row) => {
        op = "update";
        patch = values;
        return builder;
      },
      delete: () => {
        op = "delete";
        return builder;
      },
      eq: (column: string, value: unknown) => {
        filters.push(column);
        predicates.push((row) => row[column] === value);
        return builder;
      },
      neq: (column: string, value: unknown) => {
        filters.push(column);
        predicates.push((row) => row[column] !== value);
        return builder;
      },
      in: (column: string, values: unknown[]) => {
        filters.push(column);
        predicates.push((row) => values.includes(row[column]));
        return builder;
      },
      ilike: (column: string, pattern: string) => {
        filters.push(column);
        predicates.push((row) => ilikeMatches(row[column], pattern));
        return builder;
      },
      not: (column: string) => {
        filters.push(column);
        predicates.push((row) => row[column] !== null && row[column] !== undefined);
        return builder;
      },
      or: (expression: string) => {
        const id = expression.split("claimed_profile_id.eq.")[1];
        predicates.push((row) => row.claimed_profile_id === null || row.claimed_profile_id === id);
        return builder;
      },
      then(resolve: (value: { data: Row[] | null; error: { code: string } | null }) => void) {
        const failure = failures.find((f) => f.table === table && f.op === op);
        if (failure && !failure.skip) {
          resolve({ data: null, error: { code: "XX000" } });
          return;
        }
        if (failure?.skip) failure.skip -= 1;
        const rows = tables[table] ?? [];
        const matched = rows.filter((row) => predicates.every((p) => p(row))).slice(0, limit);
        if (op !== "select") log.writes.push({ table, op, filters });
        if (op === "update") matched.forEach((row) => Object.assign(row, patch));
        if (op === "delete") tables[table] = rows.filter((row) => !matched.includes(row));
        // group_invite_uses_access_request_id_fkey is ON DELETE SET NULL.
        if (op === "delete" && table === "access_requests") {
          for (const use of tables.group_invite_uses ?? []) {
            if (matched.some((row) => row.id === use.access_request_id)) use.access_request_id = null;
          }
        }
        resolve({ data: matched.map((row) => ({ ...row })), error: null });
      },
    };
    return builder;
  }

  const client = {
    from,
    auth: {
      admin: {
        getUserById: async (id: string) => {
          if (state.getUserError) return { data: { user: null }, error: state.getUserError };
          const profile = tables.profiles.find((p) => p.id === id);
          return { data: { user: { email: state.authEmail ?? profile?.email } }, error: null };
        },
        deleteUser: async (id: string) => {
          state.onDeleteUser?.();
          if (state.deleteUserError) return { error: state.deleteUserError };
          log.deletedUsers.push(id);
          if (state.cascade) tables.profiles = tables.profiles.filter((p) => p.id !== id);
          return { error: null };
        },
      },
    },
    storage: {
      from: (bucket: string) => ({
        remove: async (paths: string[]) => {
          if (state.storageError) return { data: null, error: state.storageError };
          log.removedObjects.push(...paths.map((p) => `${bucket}/${p}`));
          return { data: paths.map((name) => ({ name })), error: null };
        },
      }),
    },
  };

  return { client, log, state, failures };
}
