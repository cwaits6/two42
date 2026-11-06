// A stand-in for the church admin's request client on the roster routes: the
// six snapshot reads answer from `tables`, the address read answers from
// `addresses`, and every write is recorded so a test can assert none ran.

export interface FakeRosterOptions {
  tables?: Record<string, unknown[]>;
  addresses: { data: { profile_id: string; email: string | null }[] | null; error: { code: string } | null };
}

export function fakeRosterClient(options: FakeRosterOptions) {
  const writes: string[] = [];
  const client = {
    async rpc(fn: string) {
      return fn === "admin_member_emails" ? options.addresses : { data: null, error: { code: "PGRST202" } };
    },
    from(table: string) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: async () => ({ data: options.tables?.[table] ?? [], error: null }),
        maybeSingle: async () => ({ data: null, error: null }),
        insert: () => (writes.push(`insert ${table}`), chain),
        update: () => (writes.push(`update ${table}`), chain),
        delete: () => (writes.push(`delete ${table}`), chain),
      };
      return chain;
    },
  };
  return { client, writes };
}

/** One household of one person who hides their email. */
export const HIDDEN_ROSTER = {
  profiles: [
    {
      id: "p1",
      role: "member",
      relationship: "primary",
      first_name: "Chloe",
      last_name: "Mockingham",
      preferred_name: null,
      phone_mobile: null,
      phone_home: null,
      phone_work: null,
      birth_month: null,
      birth_day: null,
      birth_year: null,
      address_line1: null,
      address_line2: null,
      city: null,
      state: null,
      postal_code: null,
      occupation: null,
      employer: null,
      family_id: "f1",
      is_unlisted: false,
      email_announcements: true,
      hide_email: true,
    },
  ],
  family_units: [
    { id: "f1", family_name: "Mockingham", anniversary_month: null, anniversary_day: null, anniversary_year: null },
  ],
};

export const HIDDEN_ADDRESS = { profile_id: "p1", email: "chloe@example.test" };
