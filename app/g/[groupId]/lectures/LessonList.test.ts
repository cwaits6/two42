import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MetaLine } from "./LessonList";

const ITEM = /<span class="inline-block max-w-full">(.*?)<\/span>/g;
const items = (parts: React.ReactNode[]) =>
  [...renderToStaticMarkup(MetaLine({ parts })!).matchAll(ITEM)].map((m) => m[1]);

describe("MetaLine", () => {
  it("keeps each part whole, with its separator on the line it ends", () => {
    expect(items(["Acts", "Part 2", "Jun 7, 2026"])).toEqual(["Acts ·", "Part 2 ·", "Jun 7, 2026"]);
  });

  it("leaves no separator for a part that is absent", () => {
    expect(items([null, "Part 2", "", undefined, false, "Jun 7, 2026"])).toEqual([
      "Part 2 ·",
      "Jun 7, 2026",
    ]);
  });

  it("breaks only between parts", () => {
    const html = renderToStaticMarkup(MetaLine({ parts: ["Acts", "Part 2"] })!);
    expect(html.replace(ITEM, "•")).toBe('<span class="block text-base text-muted-foreground">• •</span>');
  });

  it("renders nothing when every part is absent", () => {
    expect(MetaLine({ parts: [null, ""] })).toBeNull();
  });
});
