// refreshOrg() reaches the database through narrow shapes it declares itself,
// and both callers cast the real client to them, so nothing else would notice
// a column renamed or retyped. tsc checks these; the test body never runs them.
import { describe, expectTypeOf, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import type { PROFILE_COPY_COLUMNS } from "@/supabase/functions/_shared/records-copy";
import type { HOUSEHOLD_COPY_COLUMNS } from "@/supabase/functions/_shared/records-households";
import type {
  ApplyCopyArgs,
  ApplyHouseholdCopyArgs,
  ChildSuggestionRow,
  HouseholdAnniversaryRow,
  HouseholdLinkRow,
  HouseholdMemberRow,
  HouseholdValueDbRow,
  OrgSettingsRow,
  ReplaceSuggestionsArgs,
  SyncChildrenArgs,
  FieldSettingRow,
  FieldValueRow,
  GradeRow,
  HouseholdRow,
  PersonLinkRow,
  PersonStateRow,
  ProfileRow,
  RefreshStateRow,
} from "@/supabase/functions/_shared/records-refresh";

type Tables = Database["public"]["Tables"];
type Row<T extends keyof Tables> = Tables[T]["Row"];
type Write<T extends keyof Tables> = Tables[T]["Update"];

describe("the refresh's database shapes", () => {
  it("read rows as the database returns them", () => {
    expectTypeOf<Row<"records_refresh_state">>().toMatchTypeOf<Omit<RefreshStateRow, "last_counts">>();
    expectTypeOf<Row<"records_person_state">>().toMatchTypeOf<PersonStateRow>();
    expectTypeOf<Row<"records_field_settings">>().toMatchTypeOf<FieldSettingRow>();
    expectTypeOf<Row<"records_person_links">>().toMatchTypeOf<PersonLinkRow>();
    expectTypeOf<Row<"records_field_values">>().toMatchTypeOf<Omit<FieldValueRow, "church_value">>();
    expectTypeOf<
      Pick<Row<"profiles">, "id" | "family_id" | (typeof PROFILE_COPY_COLUMNS)[number]>
    >().toMatchTypeOf<ProfileRow>();
    expectTypeOf<
      Pick<Row<"family_units">, "id" | "anniversary_month" | "anniversary_day" | "anniversary_year">
    >().toMatchTypeOf<HouseholdRow>();
    expectTypeOf<Pick<Row<"family_members">, "id" | "claimed_profile_id" | "graduation_year">>().toMatchTypeOf<GradeRow>();
    expectTypeOf<
      Pick<Row<"family_members">, "id" | "family_id" | "first_name" | "last_name" | "avatar_url">
    >().toMatchTypeOf<HouseholdMemberRow>();
    expectTypeOf<
      Pick<Row<"family_units">, "id" | "created_at" | (typeof HOUSEHOLD_COPY_COLUMNS)[number]>
    >().toMatchTypeOf<HouseholdRow>();
    expectTypeOf<Pick<Row<"profiles">, "id" | "family_id" | "relationship" | "role" | "first_name" | "last_name">>()
      .toMatchTypeOf<ProfileRow>();
    expectTypeOf<Row<"records_org_settings">>().toMatchTypeOf<OrgSettingsRow>();
    expectTypeOf<Row<"records_household_links">>().toMatchTypeOf<HouseholdLinkRow>();
    expectTypeOf<Row<"records_household_values">>().toMatchTypeOf<Omit<HouseholdValueDbRow, "church_value">>();
    expectTypeOf<Row<"records_household_anniversary">>().toMatchTypeOf<Omit<HouseholdAnniversaryRow, "church_value">>();
    expectTypeOf<Row<"records_child_suggestions">>().toMatchTypeOf<ChildSuggestionRow>();
  });

  it("write what the database accepts", () => {
    expectTypeOf<Omit<Partial<RefreshStateRow>, "last_counts">>().toMatchTypeOf<Write<"records_refresh_state">>();
    expectTypeOf<Partial<RefreshStateRow>["last_counts"]>().toMatchTypeOf<Write<"records_refresh_state">["last_counts"]>();
    expectTypeOf<Partial<PersonStateRow>>().toMatchTypeOf<Write<"records_person_state">>();
    expectTypeOf<Pick<HouseholdMemberRow, "avatar_url">>().toMatchTypeOf<Write<"family_members">>();
    expectTypeOf<Pick<ChildSuggestionRow, "photo">>().toMatchTypeOf<Write<"records_child_suggestions">>();
  });

  it("call the household functions with their arguments", () => {
    type Fn<T extends keyof Database["public"]["Functions"]> = Database["public"]["Functions"][T]["Args"];
    expectTypeOf<Omit<ReplaceSuggestionsArgs, "_suggestions">>().toMatchTypeOf<Omit<Fn<"records_replace_household_suggestions">, "_suggestions">>();
    expectTypeOf<Omit<ApplyHouseholdCopyArgs, "_expected" | "_household" | "_values">>().toMatchTypeOf<
      Omit<Fn<"records_apply_household_copy">, "_expected" | "_household" | "_values">
    >();
    expectTypeOf<Omit<SyncChildrenArgs, "_children">>().toMatchTypeOf<Omit<Fn<"records_sync_child_suggestions">, "_children">>();
  });

  it("call records_apply_copy() with its arguments", () => {
    expectTypeOf<ApplyCopyArgs>().toMatchTypeOf<Database["public"]["Functions"]["records_apply_copy"]["Args"]>();
  });
});
