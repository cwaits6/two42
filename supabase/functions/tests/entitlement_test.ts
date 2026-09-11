// The entitlement hook is `true` for every org today. This test documents
// the contract the future billing gate must preserve: attachDomainsForOrg()
// consults it before claiming any lease, and a `false` is a silent skip —
// see domain_attach_test.ts for the loop-side half of that contract.

import { assertEquals } from "jsr:@std/assert@1";
import { isAttachmentEntitled } from "../_shared/entitlement.ts";

Deno.test("every org is entitled to attachment today", () => {
  assertEquals(isAttachmentEntitled({ id: "11111111-2222-3333-4444-555555555555" }), true);
  assertEquals(isAttachmentEntitled({ id: "any-other-org" }), true);
});
