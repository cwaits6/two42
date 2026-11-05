import { describe, expect, it } from "vitest";
import nextConfig from "@/next.config";

// The measurement request goes to this site's own origin, so `same-origin` and
// the browser default would both put the real address in its Referer header.
const SENDS_NO_PATH = ["no-referrer", "origin", "strict-origin"];

describe("Referrer-Policy", () => {
  it("is set on every address, to a value that never sends a path", async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    const policies = rules.flatMap((rule) =>
      rule.headers.filter((header) => header.key.toLowerCase() === "referrer-policy").map((header) => header.value),
    );

    expect(rules.find((rule) => rule.source === "/:path*")?.headers.map((header) => header.key)).toContain(
      "Referrer-Policy",
    );
    for (const policy of policies) expect(SENDS_NO_PATH).toContain(policy);
  });
});
