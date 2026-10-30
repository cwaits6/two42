# Roles and permissions

What each role, flag and capability in two42 can see and do today, the jobs
churches need done mapped onto them, and a recommendation per role. This is
a decision document: the recommendations and the follow-ups at the end are
proposals for the maintainer to accept or reject, and nothing here changes
behavior.

The live schema is `supabase/schema.sql`; every policy and helper named
below can be read there. The tenancy rules every recommendation must keep
are in [`tenancy-model.md`](tenancy-model.md), and the service-role and
`SECURITY DEFINER` surfaces in
[`service-role-inventory.md`](service-role-inventory.md).

## The shape in one paragraph

There are four layers, each with one role above "member": the **operator**
runs the platform and sits outside every church; the **church admin** runs
one church's people, households, groups and settings; the **leader** runs
one group's content and roster; the **team lead** runs one team's serving
schedule. Every layer below the church is a membership row, not a field on
the person, so a person can lead one group and be a plain member of
another. A church admin is **not** an implicit member of any group: they
read a group's content only by joining it and edit it only by leading it.
The church admins who existed when groups were introduced do lead the one
backfilled group, through real leader rows that `group_model_backfill()`
wrote.
Around those four roles sit a handful of attributes that grant something
narrower — the household primary or spouse, the person a fund goes to — and
a set of church and group settings that widen or narrow what a role can do.

## 1. Inventory

### Roles

| Role | Stored in | Can see | Can do | Granted by |
|---|---|---|---|---|
| Anonymous visitor | — (no session) | Nothing through RLS: an anonymous request resolves no church (`app_request_org_id()` is NULL), so every isolation floor fails. The token landings (`app/join/[token]/page.tsx`, `app/join/family/[token]/page.tsx`, `/serving/go`) read their anchor row on the service client | Ask to join through a group invite link (`app/api/join/[token]/route.ts`) or a household invite (`app/api/family-invites/request/route.ts`), each writing the access request on the service client scoped to the token's church; answer a signed serving link. There is no anonymous INSERT policy on `access_requests` | — |
| Pending | `profiles.role = 'pending'` (`profiles_role_check`, `supabase/migrations/20260409000000_configurable_pages.sql`) | Their own `profiles` row, their own `organization_members` row (`"members can view their own org memberships"`) and calendar subscription token (`"Members can view own subscription token"`), their church's `organizations` row (`"Org readable within request org"`) and its public `site_settings` (`"Anon can read public settings"`). A person who signed up as pending sees nothing else: `is_member()` is false, so every member arm fails, and `handle_new_user()` and `join_group()` keep them out of groups. A person moved back to pending keeps their `group_members` rows, and `is_group_member()` and `is_group_leader()` read only those rows, not `profiles.role`; so through PostgREST they keep the group's member reads, and the same holds for their own `group_requests` and `group_join_requests`, which key on their uid alone | Edit their own profile (role and email pinned by the UPDATE policy's `WITH CHECK`). A person moved back to pending who led a group keeps its leader writes, for the same reason. App routes that need a member refuse them through `isMemberRole()` in `lib/roles.ts` (e.g. `app/profile/page.tsx`, `app/api/household/route.ts`) | `handle_new_user()` when the signup matched only a household invite; a church admin moving someone back with the role picker in `app/admin/members/page.tsx` |
| Member | `profiles.role = 'member'` | The directory: profiles and households per `organizations.directory_visibility` (`"Profiles are visible per access rules"`, `org_directory_visible()`, `shares_group_with()`); `site_settings`; `family_invites`; their own RSVPs, calendar token and group requests | File a group request under `approval` (`"Members can request a group under approval mode"`); create a group under `open` (`group_create()`); join or ask to join a discoverable group (`join_group()`, `discoverable_groups()`); send feedback; manage their own calendar subscription token | Church admin approving an access request (`app/api/admin/approve/route.ts`) or bulk invite (`app/api/admin/invite-bulk/route.ts`), which `handle_new_user()` turns into `role = coalesce(approved_role, 'member')`; the member import (`app/api/admin/members/import/route.ts`) |
| Content editor (retired) | `profiles.role = 'content_editor'`, still accepted by `profiles_role_check` | Exactly a member's view: the app reads it as `member` (`toUserRole()` in `lib/roles.ts`) and `is_member()`, `is_household_manager()` and the directory arm still list the value | Nothing beyond a member. `is_content_editor()` is still defined but no policy calls it | Nobody: the role picker and the import no longer offer it. The contract migration moves the remaining rows to `member` |
| Church admin | `profiles.role = 'admin'`; read by `is_admin()` | Every profile and household in the church; access requests; feedback; every `groups`, `group_members`, `group_labels`, `group_member_labels`, `teams`, `team_members` row (the people layer). **No group content**: `is_admin()` appears in no content policy | `/admin` (gate: `lib/supabase/middleware.ts` and `app/admin/layout.tsx`, repeated per page and by `requireOrgAdmin()` in `lib/members/access.ts`): approve access, bulk invite, import and export members, change `profiles.role`, edit households (`app/api/admin/family-members/route.ts`), church settings (`"Admins can set org settings"`, `"Admins can update settings"`), email domains, create a group naming any leader (`group_create()`), approve and decline group requests (`group_request_approve()`, `"Admins can review group requests"`), review join requests (`review_group_join_request()`), create and revoke group invite links, delete groups | `provision_organization()` stamping `approved_role = 'admin'` on the founding admin's request (`app/api/platform/organizations/route.ts`, `app/api/platform/organizations/[id]/invite-owner/route.ts`); another church admin through the role picker or import. `group_model_backfill()` made every church admin a leader of the one backfilled group |
| Group member | `group_members` row, `role = 'member'` (`supabase/migrations/20260926000000_group_model_foundation.sql`); read by `is_group_member()` | The group's events, calendar, published announcements, lessons and series, about page and teachers, prayer requests and responses, funds and their methods, teams and team rosters, serving schedule, labels, roster (`"Group members can view …"` policies) | RSVP; post and pray for prayer requests; withdraw their own responses; edit or delete their own prayer requests | Self, by joining an `open` group or redeeming an invite link (`group_invite_join()`, `group_invite_redeem()`); a leader or church admin adding them (`components/directory/useGroupRoster.ts`); a leader or church admin approving a join request; `handle_new_user()` enrolling a signup into the invite's group, or into the church's only group |
| Leader | `group_members.role = 'leader'` (`group_members_role_check`); read by `is_group_leader()` | Everything a group member sees, plus draft announcements, invite links and their uses, pending join requests (`pending_group_join_requests()`), serving broadcasts | Every content write in the group — events, announcements, lessons, series, about page, teachers, group settings, prayer call sessions, funds (`"Group leaders can …"` policies); moderate prayer requests (`"Posters and group leaders can update/delete prayer requests"`); add, remove and change the role of any member, including making another leader (`"Leaders and admins can update group members"`); teams, team rosters and team leads (`app/g/[groupId]/settings/teams/TeamRosterDialog.tsx`); labels; invite links; approve join requests; every team-lead power on every team in the group. Route gate: `requireGroupLeader()` in `lib/groups/server.ts` and the check in `app/g/[groupId]/settings/page.tsx`; UI gate: `isLeader` in `lib/groups/nav.ts` | The creator of a group (`group_create()` makes the caller, or the leader a church admin names, its first leader); another leader of the group or a church admin, through the roster's Edit mode (`components/directory/roster/EditMemberDialog.tsx`), which refuses to change the viewer's own role |
| Team member | `team_members` row (`team_members_require_group_membership` keeps it inside the team's group) | Same as group member; the Serving link in the sidebar when on at least one team with serving turned on (`hasServingAccess` in `app/layout.tsx`, `lib/groups/nav.ts`) | Sign up and withdraw for their own team's dates (`serving_signup_create()`, `"Team members and group leaders can create serving signups"`) | A leader or church admin (`TeamRosterDialog.tsx`, the member import in `lib/members/apply.ts`) |
| Team lead | `team_members.is_leader` (`supabase/migrations/20260705000000_serving_schedule.sql`); read by `is_team_lead()` | Their team's serving broadcasts (`"Team leads and group leaders can view serving broadcasts"`) | Turn serving on and set reminders for their team (`serving_team_settings` insert/update); add and remove signups on their team; "Email the team" (`app/api/serving/broadcast/route.ts`). **Not** add or remove team members: `team_members` writes are leader and church admin only | A leader or church admin (`TeamRosterDialog.tsx`, the member import) |
| Household primary or spouse | `profiles.relationship in ('primary', 'spouse')` (`supabase/migrations/20260422000001_profiles_relationships.sql`); read by `is_household_manager()` | Their household's members, as any member of a household does | Edit other profiles in their household (`"Profiles are updatable per access rules"`), add and remove household members (`"Admins and household leaders can insert/update/delete family members"`), update household info (`app/api/household/route.ts`), invite to the household (`"Admins and household primary can insert family invites"`, `app/api/family-invites/route.ts`), link an existing member (`app/api/household/link-member/route.ts`), sign their household up for serving (`app/api/serving/signups/route.ts`) | `handle_new_user()` sets `relationship = 'primary'` on every signup; a church admin (`app/api/admin/family-members/route.ts`) or the household's primary or spouse sets it when adding someone |
| Person a fund goes to | `giving_funds.steward_id` (`supabase/migrations/20260707000000_giving.sql`) | — | When the church's `giving_manage_mode` is `stewards` (the default), add a fund naming themselves and edit or delete their own fund and its methods (`giving_can_manage_fund()`, `"Group leaders and self-stewards can create funds"`) | Self, or the leader who adds the fund |
| Second person a fund goes to | `giving_funds.co_steward_id` | — | Nothing: shown on the fund (`app/g/[groupId]/give/page.tsx`) but read by no policy and no `giving_can_manage_fund()` arm. The comment in `supabase/migrations/20260731000013_composite_fks.sql` calling it a capability is wrong | Whoever adds or edits the fund |
| Operator | `platform_admins` (`supabase/migrations/20260730010000_org_spine.sql`); read by `is_platform_admin()` | `/platform`: every church, its status, email cap and email domains (service-role reads behind `requirePlatformAdmin()` in `lib/platform-access.ts`); nothing inside a church through RLS | Provision a church and invite its founding admin (`app/api/platform/organizations/route.ts`, `app/api/platform/organizations/[id]/invite-owner/route.ts`); suspend or reactivate it (`app/api/platform/organizations/[id]/route.ts`); set the email cap and clean up email domains. Gate: `lib/supabase/middleware.ts`, `app/platform/layout.tsx` and every route handler, each failing closed on an RPC error | A migration or service-role write only: the table has no write policy. Locally, `supabase/seed.sql` |

### Settings that change what a role can do

| Setting | Stored in | Effect | Set by |
|---|---|---|---|
| Directory scope | `organizations.directory_visibility` (`shared_groups` \| `org`), `supabase/migrations/20261018000000_directory_visibility.sql` | Whether a member sees everyone in the church or only people they share a group with | Church admin (`"Admins can set org settings"`, column grant) |
| Who may start a group | `organizations.group_creation_policy` (`open` \| `approval` \| `admins`), `supabase/migrations/20261025000000_group_creation.sql` | Whether a member creates a group, requests one, or cannot | Church admin |
| Group discovery | `organizations.group_discovery`, `supabase/migrations/20261026000000_group_discovery.sql` | Whether members can find groups they are not in | Church admin |
| Private group | `groups.is_private` | Hides the group from discovery whatever the church switch says | Leader or church admin |
| Join policy | `groups.join_policy` (`open` \| `approval`) | Whether a member who finds the group joins at once or asks | Leader or church admin |
| Fund management | `site_settings` key `giving_manage_mode` (`stewards` or anything else), read by `giving_stewards_can_manage()` | Whether the person a fund goes to manages it, in every group of the church | Church admin (`components/giving/GivingSettings.tsx`) |
| Serving on | `serving_team_settings.enabled` | Opens a team's schedule to its members and shows the Serving link to them | Team lead or leader |
| Serving link | `group_settings.serving_link_mode` (`signed` \| `login`), `supabase/migrations/20261017000000_group_scoped_content.sql` | Whether serving reminder emails carry a signed link that works without signing in | Leader |
| Standing team | `teams.is_serving_role`, `supabase/migrations/20260708000001_serving_roles.sql` | Lists the team on the Serving page before serving is turned on. UI only — no policy reads it | Leader |

Bearer links — group invite links (`group_invites`), household invites
(`family_invites`), calendar subscription tokens and signed serving links —
grant one narrow action to whoever holds them. They are not roles and are
covered in `tenancy-model.md` and `service-role-inventory.md`.

### Table with no reader: `organization_members`

`handle_new_user()` still writes an `organization_members` row per signup,
and the `"org members can view their orgs"` policy on `organizations` reads it
through `is_org_member()`. Nothing in the app reads either, profiles predating
`20260730010000_org_spine` were never backfilled, and `profiles.org_id` is the one membership anchor every other
helper uses (`app_current_org_id()`). It was kept as a hook for one person
belonging to several churches, which the group model did not adopt.

## 2. Jobs churches need done

| Job | Today | Fit |
|---|---|---|
| Pastor — oversees every group, wants to see what each one is doing | Church admin | **Gap.** A church admin sees every roster but no group's events, announcements, lessons or prayer requests unless they join the group. Joining every group works, but puts them on every roster and in every group's directory view |
| Office admin — approves sign-ups, keeps households and contact details current, sends invites | Church admin | **Overlap.** The only role that can approve people is the one that can also change church settings, email domains and who else is an admin. There is nothing between member and church admin |
| Group leader | Leader | Fits |
| Co-leader | Leader (any number per group, equal rights) | Fits. **Gap:** nothing keeps a group from losing its last leader — a church admin can remove them, a leader can demote another leader, and a deleted profile takes its row with it — and Admin › Groups (`app/admin/groups/page.tsx`) lists groups without a way to name a leader for an existing one. The admin RLS arm on `group_members` allows it; only the UI is missing |
| Teacher who posts lessons but runs nothing else | Leader | **Overlap.** Posting a lesson needs full leadership of the group, including the roster. `class_teachers` is a display list on the About page and grants nothing. The retired content editor was the church-wide version of this job and is not coming back |
| Team lead | Team lead | Fits for the schedule. **Gap:** a team lead cannot add or remove people on their own team; they ask a leader |
| Treasurer — keeps the giving funds accurate | Leader per group; the church admin's `giving_manage_mode` switch | **Gap, low stakes.** No money moves through two42 — a fund only points at an outside giving method — and no one role sees every group's funds. The switch is church-wide although funds belong to groups. The second person a fund goes to has no rights at all. Separately, the switch's help text says "When off, only admins can create and edit giving funds", but when it is off only leaders can |
| Read-only staff — sees the directory and rosters, changes nothing | Member (with `directory_visibility = 'org'`) | Partial fit. A member sees the directory; no one but a church admin sees every group's roster |
| Head of a household | Household primary or spouse | Fits |
| Operator | Operator | Fits. Kept out of every church on purpose: an operator who also needs to act inside a church does so with an ordinary account there |

Two further cases have no seat in any role and can lock a church out:
nothing stops the last church admin from changing their own role (the
Members page lists the viewer's own row, and the UPDATE policy's admin arm
does not compare the old and new role), and an operator can invite a new
founding admin but has no surface to promote an existing member.

## 3. Recommendations

Cost is what each change would need, sized against the rules in
`CLAUDE.md`: migrations are additive and carry pgTAP, every policy keeps the
`ORG AND (arms)` shape, and a new `SECURITY DEFINER` helper is documented in
the service-role inventory in the same pull request.

| Role | Recommendation | Migration and RLS cost |
|---|---|---|
| Pending | **Keep, and close the demotion gap.** It is the approval gate; moving someone back to pending should end their group access too | One migration: either a `profiles` trigger that deletes the person's `group_members` and `team_members` rows when their role becomes `pending`, or a non-pending check in `is_group_member()`, `is_group_leader()`, `is_team_lead()` and the direct `team_members` checks in the serving-signup authorization. The trigger is the smaller change, because it closes every path that reads a membership row, but it is one-way: approving the person again does not restore their groups, teams or leader rows, so a leader or church admin re-adds them. The helper checks keep the rows and restore access on re-approval. Neither option touches the person's own `group_requests` and `group_join_requests`, whose SELECT policies match on their uid alone; those can stay readable, as they are the person's own requests, or take a non-pending condition on the requester arm. pgTAP in `supabase/tests/group_roster_suite.sql` |
| Member | **Keep** | None |
| Content editor | **Retired** (separate work). The contract migration that moves the rows to `member` is the place to drop `is_content_editor()` and the value from `is_member()`, `is_household_manager()`, the directory arm and the directory views | Owned by that migration |
| Church admin | **Keep, and protect the last one.** Refuse a change that would leave a church with no admin | One migration: a `profiles` trigger that locks the church's admin rows (`for update`) before counting them and refuses the last admin's demotion — a count-only `WITH CHECK` arm lets two concurrent demotions each see the other admin and both commit — plus a pgTAP case; the Members page hides or disables the viewer's own role picker. No new role, no policy rewrite |
| Office admin (new role between member and church admin) | **Do not add yet.** One church is live and its church admin does this job; add it when a church asks for staff who must not change settings | Large. A new `profiles.role` value and `profiles_role_check`; an `is_staff()`-style helper; an extra arm on the people-layer policies (49 policies call `is_admin()` today, most of them people-layer); splitting the `/admin` gate in `lib/supabase/middleware.ts`, `app/admin/layout.tsx`, `requireOrgAdmin()` and each admin page and route; `lib/roles.ts`, `lib/admin-nav.ts`, the role picker and the import; pgTAP across the directory, household and group suites |
| Pastor oversight (read every group without joining) | **Do not add yet.** Joining the groups they oversee covers it today, and an implicit read of every group's prayer requests is a privacy change a church should choose, not inherit | Large if added: a church-wide read arm on every content table (about a dozen tables, each `"Group members can view …"` policy), excluding prayer unless chosen; a typed `organizations` column if it is a setting; group-scope pgTAP and an e2e spec for the boundary |
| Leader | **Keep, and let a church admin name one for any group.** Covers co-leaders as they are | No migration: the admin arm on `group_members` already permits it. UI in Admin › Groups; an e2e spec only if it changes what a member sees. A last-leader guard, if wanted, is one trigger on `group_members` with pgTAP in `supabase/tests/group_roster_suite.sql` |
| Co-leader (separate role) | **Do not add.** Several leaders with equal rights is what groups do; a second tier would split every leader arm | — |
| Teacher (lessons only) | **Do not add yet.** A leader posts lessons; revisit only if a church asks to keep teachers off the roster | Medium if added: a `group_members.role` value and `group_members_role_check`, an `is_group_teacher()`-style helper, an arm on the `lectures` and `lecture_series` write policies, `GroupRole` in `lib/groups/active.ts` and `lib/groups/memberships.ts`, the role picker |
| Team member | **Keep** | None |
| Team lead | **Keep, and let them manage their own team's roster.** The membership trigger already keeps every team member inside the group | Small. An `is_team_lead(team_id)` arm on the `team_members` insert policy with `is_leader = false` in its `WITH CHECK`, and on the delete policy limited to rows where `is_leader = false`; no update arm. A team lead can add and remove team members but cannot make, unmake or remove a team lead; pgTAP in `supabase/tests/serving_signup_rpc_suite.sql` or `group_roster_suite.sql`; a roster control on `app/g/[groupId]/serving/[teamId]/page.tsx` |
| Household primary or spouse | **Keep** | None |
| Person a fund goes to | **Keep** | None |
| Second person a fund goes to | **Keep as display only, and say so.** Granting them management is one more arm with no request behind it | None, beyond correcting the description where it is documented; the comment in the composite-FK migration cannot be edited in place |
| Treasurer | **Do not add.** No money moves through two42 | — |
| Operator | **Keep.** Granted by migration or service-role write, which suits a role with cross-church reach | None. Restoring a church's admin stays a service-role operation until it happens often enough to need a surface |
| `organization_members` | **Retire**, unless one sign-in across several churches is planned | Not additive, so it needs the maintainer's explicit exception to the additive-migration rule, or two steps: first re-create `handle_new_user()` without the insert and drop the policy and helper, then drop the table in a later migration once nothing reads it. Either way: drop the `"org members can view their orgs"` policy, `is_org_member()` and the table; re-create `handle_new_user()` without the insert (it is `SECURITY DEFINER`, so its inventory entry changes too); update `supabase/tests/tenancy_leak_suite.sql`, `tenancy_signup_provisioning_suite.sql`, `branding_rls_suite.sql`, `idor_suite.sql` and `schema_tenancy_lint.sql`; regenerate `lib/supabase/database.types.ts` |

## Proposed follow-ups

For the maintainer to accept; none is filed.

1. **Keep at least one church admin** — refuse the last admin's own demotion in the database and hide the viewer's own role picker on the Members page.
2. **Name a leader from Admin › Groups** — a church admin can set or replace a group's leaders, so a leaderless group can be recovered without joining it.
3. **Team leads manage their team's roster** — add and remove members of their own team.
4. **Fix the fund-management help text** — `components/giving/GivingSettings.tsx` says "only admins" where only leaders can.
5. **Retire `organization_members`** — drop the table, its helper and its policy.
6. **Record the trigger for an office admin role** — add it when a church asks for staff who approve people but must not change settings; until then, no work.
7. **End group access when someone is moved back to pending** — today they keep their group reads, and a leader keeps their writes, until a leader or church admin also removes them from the group.
