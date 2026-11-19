// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { FamilyCard } from "./FamilyCard";
import type { FamilyDirectoryFull } from "@/lib/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
});

describe("FamilyCard", () => {
  it("labels an adult child with an account, once, and a child without one by name alone", async () => {
    const person = (first_name: string, relationship: string) => ({
      id: first_name,
      first_name,
      last_name: "Mockingham",
      preferred_name: null,
      avatar_url: null,
      relationship,
    });
    const family = {
      id: "f1",
      family_name: "Mockingham",
      members: [{ ...person("Grown", "child"), phone_mobile: null }],
      family_members_list: [
        { ...person("Grown", "child"), claimed_profile_id: "p1" },
        { ...person("Jack", "child"), claimed_profile_id: null },
        { ...person("Pat", "parent"), claimed_profile_id: null },
      ],
    } as unknown as FamilyDirectoryFull;

    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root.render(
        createElement(FamilyCard, { family, profileMap: {}, onOpenPerson: () => {}, viewerFamilyId: null }),
      );
    });

    expect(host.textContent!.match(/Grown Mockingham/g)).toHaveLength(1);
    expect(host.textContent).toContain("Grown MockinghamChild");
    expect(host.textContent).not.toContain("Jack MockinghamChild");
    expect(host.textContent).toContain("Pat MockinghamParent");
  });

  it("offers Edit household on the viewer's own household only", async () => {
    // The viewer is hidden from the directory, so the listed members are someone else.
    const family = {
      id: "f1",
      family_name: "Mockingham",
      members: [
        {
          id: "spouse",
          first_name: "Sam",
          last_name: "Mockingham",
          preferred_name: null,
          avatar_url: null,
          relationship: "spouse",
          phone_mobile: null,
        },
      ],
      family_members_list: [],
    } as unknown as FamilyDirectoryFull;
    const render = async (viewerFamilyId: string | null) => {
      await act(async () => {
        root.render(
          createElement(FamilyCard, { family, profileMap: {}, onOpenPerson: () => {}, viewerFamilyId }),
        );
      });
    };

    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    await render("f1");
    const link = [...host.querySelectorAll("a")].find((a) => a.textContent === "Edit household");
    expect(link?.getAttribute("href")).toBe("/profile?tab=household");

    await render("f2");
    expect(host.textContent).not.toContain("Edit household");

    await render(null);
    expect(host.textContent).not.toContain("Edit household");
  });
});
