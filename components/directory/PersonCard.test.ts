// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PersonCard } from "./PersonCard";
import type { DirectoryProfile } from "@/lib/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
});

const profile = {
  id: "me",
  first_name: "Sam",
  last_name: "Mockingham",
  preferred_name: null,
  avatar_url: null,
  relationship: "primary",
  family_id: null,
  groups: [],
} as unknown as DirectoryProfile;

async function render(viewerId?: string) {
  await act(async () => {
    root.render(createElement(PersonCard, { profile, family: null, viewerId }));
  });
}

const editLink = () =>
  [...host.querySelectorAll("a")].find((a) => a.textContent === "Edit my details");

describe("PersonCard", () => {
  it("offers Edit my details on the viewer's own entry, opening the profile", async () => {
    await render("me");
    expect(editLink()?.getAttribute("href")).toBe("/profile");
  });

  it("does not offer it on someone else's entry", async () => {
    await render("someone-else");
    expect(editLink()).toBeUndefined();
  });

  it("does not offer it where no viewer is passed, as in the profile preview", async () => {
    await render();
    expect(editLink()).toBeUndefined();
  });
});
