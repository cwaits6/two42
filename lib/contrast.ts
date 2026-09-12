/**
 * Pure WCAG contrast math and the branding.accent write-path guard.
 * Client-safe on purpose: lib/branding.ts (which re-exports
 * this module's API) imports @/lib/supabase/server and so can never reach a
 * "use client" component — the /platform branding form imports its live
 * contrast readout from here instead. Keep this module free of server
 * imports.
 */

// accent is interpolated into every CSS context this app emits — the <style>
// block in app/layout.tsx and the inline style="" attributes throughout
// lib/email/* — with no per-sink escaping. This strict hex shape is the
// CSS-injection guard for all of them. Do not relax it.
export const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * WCAG 4.5:1 is enforced on the WRITE path only. accent is rendered as
 * a button BACKGROUND carrying the hardcoded --primary-foreground: #FFFFFF
 * (app/globals.css:68-69), so white is the reference — and by symmetry the
 * same ratio covers accent-as-link-text on white. It is deliberately NOT
 * measured against Warm Paper (#F4EEE2): the platform's own Clay default
 * scores 3.93:1 there, which is why DESIGN.md reserves deep clay (#8A4227)
 * for body text on light grounds. Do not "fix" this by changing the
 * reference.
 *
 * Scope: the SOLID fill only. Buttons darken on hover by compositing the
 * accent at 90% alpha (`hover:bg-brand-primary/90`, and the shadcn Button
 * default variant), and that composite is NOT validated here — Clay's is
 * ~3.84:1 over a white card. Validating it would reject Clay itself; the fix
 * is a solid darkened hover token, tracked as an accepted limit in
 * docs/design/DESIGN.md. Do not raise ACCENT_CONTRAST_MIN to cover it.
 */
export const ACCENT_CONTRAST_REFERENCE = "#FFFFFF";
export const ACCENT_CONTRAST_MIN = 4.5;

function channelLuminance(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance of a validated 6-digit hex color. */
export function relativeLuminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return (
    0.2126 * channelLuminance((n >> 16) & 0xff) +
    0.7152 * channelLuminance((n >> 8) & 0xff) +
    0.0722 * channelLuminance(n & 0xff)
  );
}

/** WCAG contrast ratio between two validated 6-digit hex colors. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export type AccentValidation =
  | { ok: true; accent: string; ratio: number }
  | { ok: false; reason: string };

/**
 * Write-path guard for branding.accent. Rejects anything HEX rejects (the
 * CSS-injection boundary) and anything below ACCENT_CONTRAST_MIN. Clay
 * #B85C38 passes at 4.539:1 with only 0.039 of headroom, so the exact sRGB
 * linearization above is load-bearing — never round the ratio before
 * comparing.
 */
export function validateAccent(raw: unknown): AccentValidation {
  if (typeof raw !== "string" || !HEX.test(raw)) {
    return { ok: false, reason: "Accent must be a 6-digit hex color such as #B85C38." };
  }
  const ratio = contrastRatio(raw, ACCENT_CONTRAST_REFERENCE);
  if (ratio < ACCENT_CONTRAST_MIN) {
    return {
      ok: false,
      reason: `Accent ${raw} has ${ratio.toFixed(2)}:1 contrast against white text; 4.5:1 is required.`,
    };
  }
  return { ok: true, accent: raw, ratio };
}
