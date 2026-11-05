import { describe, expect, it } from "vitest";
import { addOrganizationErrors } from "@/app/platform/organizations/OrganizationsList";

describe("addOrganizationErrors", () => {
  it("finds nothing wrong with a name and a valid email", () => {
    expect(addOrganizationErrors("Grace Chapel", "admin@gracechapel.org")).toEqual({});
  });

  it("marks each empty field on its own", () => {
    expect(addOrganizationErrors("", "")).toEqual({
      "org-name": "Enter the organization's name.",
      "org-owner-email": "Enter the first admin's email.",
    });
    expect(addOrganizationErrors("Grace Chapel", "")).toEqual({
      "org-owner-email": "Enter the first admin's email.",
    });
  });

  it("marks an email that is malformed or too long", () => {
    const invalid = { "org-owner-email": "Enter an email address like name@example.com." };
    expect(addOrganizationErrors("Grace Chapel", "admin@gracechapel")).toEqual(invalid);
    expect(addOrganizationErrors("Grace Chapel", `${"a".repeat(250)}@b.co`)).toEqual(invalid);
  });
});
