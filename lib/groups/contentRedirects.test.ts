import { describe, expect, it } from "vitest";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import { prepareDestination } from "next/dist/shared/lib/router/utils/prepare-destination";
import nextConfig from "@/next.config";

const G = "/g/11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";

/** Resolves a URL through the configured redirects with the matcher Next itself uses. */
async function redirectOf(pathname: string, query: Record<string, string> = {}) {
  const redirects = (await nextConfig.redirects?.()) ?? [];
  for (const { source, destination, permanent } of redirects) {
    const params = getPathMatch(source, { strict: true })(pathname);
    if (!params) continue;
    const target = prepareDestination({ destination, params, query, appendParamsToQuery: false });
    return {
      path: target.parsedDestination.pathname,
      query: target.parsedDestination.query,
      permanent,
    };
  }
  return null;
}

describe("content redirects", () => {
  it.each([
    [`${G}/settings/announcements`, `${G}/announcements`],
    [`${G}/settings/announcements/new`, `${G}/announcements/new`],
    [`${G}/settings/announcements/${ID}/edit`, `${G}/announcements/${ID}/edit`],
    [`${G}/settings/lectures`, `${G}/lectures`],
    [`${G}/settings/lectures/new`, `${G}/lectures/new`],
    [`${G}/settings/lectures/${ID}/edit`, `${G}/lectures/${ID}/edit`],
    [`${G}/settings/lectures/series`, `${G}/lectures/series`],
    [`${G}/settings/lectures/series/new`, `${G}/lectures/series/new`],
    [`${G}/settings/lectures/series/${ID}/edit`, `${G}/lectures/series/${ID}/edit`],
    [`${G}/settings/about`, `${G}/about/edit`],
    [`${G}/settings/about/save`, `${G}/about/save`],
    [`${G}/settings/giving`, `${G}/give`],
  ])("sends %s to %s", async (from, to) => {
    expect(await redirectOf(from)).toMatchObject({ path: to, permanent: true });
  });

  it.each([
    [`${G}/settings/lectures/new`, { series: ID }],
    [`${G}/settings/lectures`, { filter: "needs-summary" }],
  ])("keeps the query string of %s", async (from, query) => {
    expect((await redirectOf(from, query))?.query).toEqual(query);
  });

  it.each([
    "/settings",
    `${G}/settings`,
    `${G}/settings/details`,
    `${G}/settings/privacy`,
    `${G}/settings/invites`,
    `${G}/settings/serving`,
    `${G}/settings/teams`,
    `${G}/settings/labels`,
    `${G}/announcements/new`,
    `${G}/lectures/series`,
    `${G}/about/edit`,
    `${G}/give`,
  ])("leaves %s where it is", async (path) => {
    expect(await redirectOf(path)).toBeNull();
  });
});
