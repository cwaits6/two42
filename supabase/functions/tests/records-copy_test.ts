import { assertEquals } from "jsr:@std/assert@1";
import {
  type Columns,
  type CopyInput,
  type FieldMode,
  planPersonCopy,
  type RecordsField,
  type StoredValue,
  type ValueField,
} from "../_shared/records-copy.ts";
import { normalizePhone } from "../_shared/phone.ts";
import type { RecordsCopyPerson } from "../_shared/records-types.ts";

const TODAY = new Date("2026-11-26T12:00:00Z");

function person(over: Partial<RecordsCopyPerson> = {}): RecordsCopyPerson {
  return {
    id: "100",
    firstName: "Margaret",
    lastName: "Hale",
    nickName: "Margaret",
    title: null,
    suffix: null,
    gender: "female",
    mobile: { countryCode: "1", number: "5125550123" },
    work: null,
    birthday: { month: 3, day: 14, year: 1961 },
    anniversary: { month: null, day: null, year: null },
    graduationYear: null,
    photo: null,
    ...over,
  };
}

function profile(over: Columns = {}): Columns {
  return {
    first_name: "Margaret",
    last_name: "Hale",
    preferred_name: null,
    title: null,
    suffix: null,
    gender: null,
    phone_mobile: null,
    phone_work: null,
    birth_month: null,
    birth_day: null,
    birth_year: null,
    avatar_url: null,
    ...over,
  };
}

function input(
  settings: Record<string, FieldMode>,
  over: Omit<Partial<CopyInput>, "stored"> & { stored?: Record<string, StoredValue> } = {},
): CopyInput {
  return {
    settings: new Map(Object.entries(settings)) as Map<RecordsField, FieldMode>,
    current: { profile: profile(), household: null, grade: null },
    person: person(),
    normalizePhone,
    today: TODAY,
    ...over,
    stored: new Map(Object.entries(over.stored ?? {})) as Map<ValueField, StoredValue>,
  };
}

Deno.test("with every field not from the records, nothing is planned", () => {
  const plan = planPersonCopy(input({}, { current: { profile: profile({ phone_mobile: "+15125550999" }), household: null, grade: null } }));
  assertEquals(plan, { profile: {}, household: {}, grade: {}, values: [], filled: [], photoWanted: null });
});

Deno.test("a member-changeable phone fills an empty one and tells the member", () => {
  const plan = planPersonCopy(input({ phone_mobile: "member" }));
  assertEquals(plan.profile, { phone_mobile: "+15125550123" });
  assertEquals(plan.values, [{ field: "phone_mobile", state: "records", church_value: { phone_mobile: "+15125550123" } }]);
  assertEquals(plan.filled, ["phone_mobile"]);
});

Deno.test("turning a field on never replaces what the member entered; it offers the church's value", () => {
  const plan = planPersonCopy(
    input({ phone_mobile: "member" }, { current: { profile: profile({ phone_mobile: "+15125550999" }), household: null, grade: null } }),
  );
  assertEquals(plan.profile, {});
  assertEquals(plan.values, [{ field: "phone_mobile", state: "changed", church_value: { phone_mobile: "+15125550123" } }]);
  assertEquals(plan.filled, []);
});

Deno.test("a value from the records follows the records, a removal included", () => {
  const stored = { phone_mobile: { state: "records" as const, churchValue: { phone_mobile: "+15125550123" } } };
  const current = { profile: profile({ phone_mobile: "+15125550123" }), household: null, grade: null };
  const moved = planPersonCopy(
    input({ phone_mobile: "member" }, { stored, current, person: person({ mobile: { countryCode: "1", number: "5125550188" } }) }),
  );
  assertEquals(moved.profile, { phone_mobile: "+15125550188" });
  const removed = planPersonCopy(input({ phone_mobile: "member" }, { stored, current, person: person({ mobile: null }) }));
  assertEquals(removed.profile, { phone_mobile: null });
  assertEquals(removed.values[0].state, "records");
});

Deno.test("a member's edit is left alone; only the church's value is kept up to date", () => {
  const plan = planPersonCopy(
    input({ phone_mobile: "member" }, {
      stored: { phone_mobile: { state: "changed", churchValue: { phone_mobile: "+15125550100" } } },
      current: { profile: profile({ phone_mobile: "+15125550999" }), household: null, grade: null },
    }),
  );
  assertEquals(plan.profile, {});
  assertEquals(plan.values, [{ field: "phone_mobile", state: "changed", church_value: { phone_mobile: "+15125550123" } }]);
});

Deno.test("a member's edit stays theirs when the church's value comes to match it", () => {
  const plan = planPersonCopy(
    input({ phone_mobile: "member" }, {
      stored: { phone_mobile: { state: "changed", churchValue: { phone_mobile: "+15125550100" } } },
      current: { profile: profile({ phone_mobile: "+15125550123" }), household: null, grade: null },
    }),
  );
  assertEquals(plan.profile, {});
  assertEquals(plan.values, [{ field: "phone_mobile", state: "changed", church_value: { phone_mobile: "+15125550123" } }]);
});

Deno.test("a cleared birthday stays empty when the records still hold one", () => {
  const plan = planPersonCopy(
    input({ birthday: "member" }, {
      stored: { birthday: { state: "cleared", churchValue: { birth_month: 3, birth_day: 14, birth_year: 1961 } } },
      person: person({ birthday: { month: 3, day: 15, year: 1961 } }),
    }),
  );
  assertEquals(plan.profile, {});
  assertEquals(plan.values, [
    { field: "birthday", state: "cleared", church_value: { birth_month: 3, birth_day: 15, birth_year: 1961 } },
  ]);
});

Deno.test("an unlisted phone arrives as no phone and fills nothing", () => {
  // The Rock source drops unlisted numbers when it reads them (rock-copy_test.ts).
  const plan = planPersonCopy(input({ phone_mobile: "member" }, { person: person({ mobile: null }) }));
  assertEquals(plan, { profile: {}, household: {}, grade: {}, values: [], filled: [], photoWanted: null });
});

Deno.test("a phone two42 can't save counts as none", () => {
  const plan = planPersonCopy(input({ phone_mobile: "member" }, { person: person({ mobile: { countryCode: "1", number: "1235550123" } }) }));
  assertEquals(plan.values, []);
});

Deno.test("a locked field takes the church's value over the member's, an empty one included", () => {
  const plan = planPersonCopy(
    input({ name: "locked", suffix: "locked" }, {
      stored: { name: { state: "changed", churchValue: { first_name: "Margaret", last_name: "Hale" } } },
      current: { profile: profile({ first_name: "Peggy", suffix: "Jr." }), household: null, grade: null },
    }),
  );
  assertEquals(plan.profile, { first_name: "Margaret", last_name: "Hale", suffix: null });
  assertEquals(
    plan.values.map((v) => `${v.field}:${v.state}`),
    ["name:records", "suffix:records"],
  );
});

Deno.test("names are cased the way the profile form saves them", () => {
  const plan = planPersonCopy(
    input({ name: "locked" }, {
      person: person({ firstName: "MARGARET", lastName: "mcdonald" }),
      current: { profile: profile({ first_name: null, last_name: null }), household: null, grade: null },
    }),
  );
  assertEquals(plan.profile, { first_name: "Margaret", last_name: "McDonald" });
});

Deno.test("a name missing its last part isn't copied", () => {
  const plan = planPersonCopy(input({ name: "locked" }, { person: person({ lastName: "" }) }));
  assertEquals(plan.values.filter((v) => v.field === "name"), []);
});

Deno.test("the nick name fills the preferred name only while the member hasn't set one", () => {
  const nick = person({ nickName: "Peggy" });
  const empty = planPersonCopy(input({ name: "member" }, { person: nick }));
  assertEquals(empty.profile, { preferred_name: "Peggy" });
  assertEquals(empty.filled, ["preferred_name"]);

  const own = planPersonCopy(
    input({ name: "member" }, { person: nick, current: { profile: profile({ preferred_name: "Meg" }), household: null, grade: null } }),
  );
  assertEquals(own.profile, {});
  assertEquals(own.values.filter((v) => v.field === "preferred_name"), []);

  const matching = planPersonCopy(
    input({ name: "member" }, { person: nick, current: { profile: profile({ preferred_name: "Peggy" }), household: null, grade: null } }),
  );
  assertEquals(matching.profile, {});
  assertEquals(matching.values.filter((v) => v.field === "preferred_name"), []);

  const sameAsFirst = planPersonCopy(input({ name: "member" }, { person: person({ nickName: "Margaret" }) }));
  assertEquals(sameAsFirst.profile, {});
});

Deno.test("a date the forms wouldn't save counts as none, and a future year is dropped", () => {
  const bad = planPersonCopy(input({ birthday: "member" }, { person: person({ birthday: { month: 2, day: 30, year: 1961 } }) }));
  assertEquals(bad.values, []);
  const future = planPersonCopy(input({ birthday: "member" }, { person: person({ birthday: { month: 3, day: 14, year: 2030 } }) }));
  assertEquals(future.profile, { birth_month: 3, birth_day: 14, birth_year: null });
});

Deno.test("the anniversary needs a household and the grade a household member row", () => {
  const church = person({ anniversary: { month: 6, day: 1, year: 2001 }, graduationYear: 2031 });
  const none = planPersonCopy(input({ anniversary: "member", grade: "locked" }, { person: church }));
  assertEquals(none.values, []);
  const both = planPersonCopy(
    input({ anniversary: "member", grade: "locked" }, {
      person: church,
      current: {
        profile: profile(),
        household: { anniversary_month: null, anniversary_day: null, anniversary_year: null },
        grade: { graduation_year: null },
      },
    }),
  );
  assertEquals(both.household, { anniversary_month: 6, anniversary_day: 1, anniversary_year: 2001 });
  assertEquals(both.grade, { graduation_year: 2031 });
});

Deno.test("someone who moved household, their anniversary source dropped, keeps the new household's date and fills an empty one", () => {
  const church = person({ anniversary: { month: 6, day: 1, year: 2001 } });
  const entered = { anniversary_month: 9, anniversary_day: 20, anniversary_year: 1998 };
  const moved = (household: Columns, stored: Record<string, StoredValue> = {}) =>
    planPersonCopy(input({ anniversary: "member" }, { person: church, current: { profile: profile(), household, grade: null }, stored }));

  const kept = moved(entered);
  assertEquals(kept.household, {});
  assertEquals(kept.values, [{ field: "anniversary", state: "changed", church_value: { anniversary_month: 6, anniversary_day: 1, anniversary_year: 2001 } }]);

  const filled = moved({ anniversary_month: null, anniversary_day: null, anniversary_year: null });
  assertEquals(filled.household, { anniversary_month: 6, anniversary_day: 1, anniversary_year: 2001 });
  assertEquals(filled.filled, ["anniversary"]);

  // Why the source goes before the copy is marked: the old household's would replace the date.
  const oldSource = moved(entered, { anniversary: { state: "records", churchValue: { anniversary_month: 6, anniversary_day: 1, anniversary_year: 2001 } } });
  assertEquals(oldSource.household, { anniversary_month: 6, anniversary_day: 1, anniversary_year: 2001 });
});

Deno.test("the church's photo is downloaded only to fill an empty photo or follow a new one", () => {
  const withPhoto = person({ photo: "77" });
  const empty = planPersonCopy(input({ photo: "member" }, { person: withPhoto }));
  assertEquals(empty.photoWanted, "77");
  assertEquals(empty.values, []);

  const stored = planPersonCopy(input({ photo: "member" }, { person: withPhoto, storedPhoto: { token: "77", url: "https://x/a.jpg" } }));
  assertEquals(stored.profile, { avatar_url: "https://x/a.jpg" });
  assertEquals(stored.values, [{ field: "photo", state: "records", church_value: { photo: "77", avatar_url: "https://x/a.jpg" } }]);

  const own = planPersonCopy(
    input({ photo: "member" }, { person: withPhoto, current: { profile: profile({ avatar_url: "https://x/own.jpg" }), household: null, grade: null } }),
  );
  assertEquals(own.photoWanted, null);
  assertEquals(own.values, []);

  const unchanged = planPersonCopy(
    input({ photo: "member" }, {
      person: withPhoto,
      stored: { photo: { state: "records", churchValue: { photo: "77", avatar_url: "https://x/a.jpg" } } },
      current: { profile: profile({ avatar_url: "https://x/a.jpg" }), household: null, grade: null },
    }),
  );
  assertEquals(unchanged.photoWanted, null);

  const replaced = planPersonCopy(
    input({ photo: "member" }, {
      person: withPhoto,
      stored: { photo: { state: "changed", churchValue: { photo: "70", avatar_url: "https://x/a.jpg" } } },
      current: { profile: profile({ avatar_url: "https://x/own.jpg" }), household: null, grade: null },
    }),
  );
  assertEquals(replaced.photoWanted, null);
  assertEquals(replaced.profile, {});
});
