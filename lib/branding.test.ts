// Unit tests for the branding injection boundary. Pure units: no
// network, no database — resolveBranding is a pure merge over untrusted jsonb.
// HEX and the control-character strip are the CSS / RFC 5322 injection guards
// (see CLAUDE.md "UI conventions"); these tests pin them.

import { afterEach, describe, expect, it, vi } from "vitest";
import { BRANDING_DEFAULTS, resolveBranding } from "@/lib/branding";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveBranding", () => {
  it("falls back entirely on non-object input", () => {
    for (const raw of [null, undefined, [], "str", 42, true]) {
      expect(resolveBranding(raw)).toEqual(BRANDING_DEFAULTS);
    }
  });

  describe("accent (CSS-injection boundary)", () => {
    it("accepts a strict 6-digit hex color", () => {
      // Not the default value — proves acceptance, not fallback.
      expect(resolveBranding({ accent: "#123abc" }).accent).toBe("#123abc");
      expect(resolveBranding({ accent: "#B85C38" }).accent).toBe("#B85C38");
    });

    it("rejects everything that is not exactly #RRGGBB", () => {
      const rejected = [
        "#abc", // 3-digit shorthand
        "red", // named color
        "rgb(0,0,0)", // functional notation
        "#GGGGGG", // non-hex digits
        " #B85C38 ", // whitespace — HEX is anchored, no trimming
        "#B85C38AA", // 8-digit
        42, // non-string
      ];
      for (const accent of rejected) {
        expect(resolveBranding({ accent }).accent).toBe(BRANDING_DEFAULTS.accent);
      }
    });

    it("rejects a CSS-injection payload (the anchored ^…$ is the guard)", () => {
      const payload = "#B85C38;}body{background:url(x)";
      expect(resolveBranding({ accent: payload }).accent).toBe(BRANDING_DEFAULTS.accent);
    });
  });

  describe("display_name (header/title boundary)", () => {
    it("strips C0/C1 control characters", () => {
      // Built with fromCharCode so no raw control bytes live in this file:
      // NUL (C0), BEL (C0), and a C1 control (0x9C) inside "First Church".
      const name =
        "Fir" + String.fromCharCode(0x00) + "st" + String.fromCharCode(0x07, 0x9c) + " Church";
      expect(resolveBranding({ display_name: name }).display_name).toBe("First Church");
    });

    it("strips CR/LF (header injection)", () => {
      expect(resolveBranding({ display_name: "A\r\nB" }).display_name).toBe("AB");
    });

    it("falls back when the name is only control characters", () => {
      const onlyControls = String.fromCharCode(0x01, 0x0b, 0x7f, 0x9f);
      expect(resolveBranding({ display_name: onlyControls }).display_name).toBe(
        BRANDING_DEFAULTS.display_name
      );
    });

    it("trims surrounding whitespace", () => {
      expect(resolveBranding({ display_name: "  Grace Chapel  " }).display_name).toBe(
        "Grace Chapel"
      );
    });
  });

  describe("reply_to (RFC 5322 Reply-To boundary)", () => {
    it("keeps a valid address", () => {
      expect(resolveBranding({ reply_to: "office@example.org" }).reply_to).toBe(
        "office@example.org"
      );
    });

    it("treats empty string as unset, with no warning", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      expect(resolveBranding({ reply_to: "" }).reply_to).toBeNull();
      expect(warn).not.toHaveBeenCalled();
    });

    it("rejects a header-injection payload and warns", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      expect(resolveBranding({ reply_to: "a@b.c\r\nBcc: x@y.z" }).reply_to).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it("rejects angle brackets, spaces, and dotless domains", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      for (const reply_to of ["<a@b.c>", "a b@c.d", "a@b"]) {
        expect(resolveBranding({ reply_to }).reply_to).toBeNull();
      }
      expect(warn).toHaveBeenCalledTimes(3);
    });

    it("enforces the <= 254 length bound", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const at254 = "a".repeat(242) + "@example.com"; // 254 chars — kept
      const at255 = "a".repeat(243) + "@example.com"; // 255 chars — dropped
      expect(resolveBranding({ reply_to: at254 }).reply_to).toBe(at254);
      expect(resolveBranding({ reply_to: at255 }).reply_to).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
    });
  });

  it("falls back per-key: one invalid key does not discard a valid sibling", () => {
    const resolved = resolveBranding({
      display_name: "Valid Org",
      accent: "javascript:alert(1)",
    });
    expect(resolved.display_name).toBe("Valid Org");
    expect(resolved.accent).toBe(BRANDING_DEFAULTS.accent);
  });

  it("keeps string logo_url and nulls everything else", () => {
    expect(resolveBranding({ logo_url: "https://x.test/l.png" }).logo_url).toBe(
      "https://x.test/l.png"
    );
    expect(resolveBranding({ logo_url: 42 }).logo_url).toBeNull();
  });
});
