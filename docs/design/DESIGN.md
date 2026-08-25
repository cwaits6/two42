# two42 — Design System

A living design system for two42. Changes come via PR. When guidance conflicts, precedence is: the maintainer's explicit words → this document → the project's existing tokens.

---

## Brand

**Name:** two42 — always lowercase. It reads aloud as "two forty-two" → **Acts 2:42** (the early church: teaching, fellowship, breaking bread, and prayer). The reference is carried by how the name is said; there is no literal colon.

**What it is:** software for church **connection groups**. Each **church is an organization** that contains its **groups**. Open source under **AGPL-3.0** and self-hostable; the hosted service is the business. Every feature is open — nothing is gated behind a paid tier.

**Voice:** plain, functional copy — verb+noun labels, no salesy subtitles or cute metaphors. The audience runs from adults in their 30s–50s (the core) up to their 80s; design for the oldest members (large type, high contrast, generous touch targets) without feeling dated to the youngest. See [Accessibility floor](#accessibility-floor).

---

## Wordmark

Canonical assets are outlined SVGs in [`public/brand/`](../../public/brand) — Fraunces converted to vector paths, so the mark never silently falls back to a system font.

- **Lockup:** `two` (lowercase word) + `42` (numeral), read together as "two forty-two."
- **The `42` is the focal element — set apart by color, not weight.** `two` and `42` share one weight (Fraunces ≈ 580, `-0.02em` tracking, display optical size); the `42` carries the accent color while `two` takes the ink color. The canonical SVGs are generated this way.
- **Typeface:** Fraunces (variable display serif, high-contrast, display optical size).

| File | Use |
|---|---|
| `two42-wordmark.svg` | Espresso `two` + Clay `42` — **light** backgrounds |
| `two42-wordmark-dark.svg` | Warm Paper `two` + Marigold `42` — **dark** backgrounds |
| `two42-mark.svg` | the `42` tile (Marigold on a Clay ground, rounded square) — favicon, avatar, app icon |

**Rules**
- Never re-typeset the wordmark in a live font — ship the SVG.
- Clearspace: keep at least the height of the `4` clear on all sides.
- Minimum wordmark width ≈ 96px; below that, use the tile.
- Don't recolor beyond the provided light/dark variants; don't stretch, skew, outline, or add effects.

---

## Typography

| Role | Typeface |
|---|---|
| Wordmark / display / headings | **Fraunces** (variable serif) — warmth + authority |
| UI / body | **Inter** (variable sans) — legible from captions to headers |
| Data / mono | **JetBrains Mono** — tabular numerals |

Fraunces and Inter load via `next/font/google`.

---

## Color

Warm and earthen — deliberately not the church-tech default blue. Four brand colors, taken directly from the "The Table" wordmark study:

| Name | Hex | Role |
|---|---|---|
| **Clay** | `#B85C38` | primary accent — primary actions, active nav, and the `42` on light grounds. Deep clay `#8A4227` for gradients and as the text-safe variant on light grounds. |
| **Marigold** | `#E8A33D` | secondary highlight — the `42` on dark grounds, plus accents and highlights |
| **Espresso** | `#2A211A` | ink on light grounds / dark-mode ground |
| **Warm Paper** | `#F4EEE2` | light-mode ground / text on dark grounds |

Semantic colors (success / warning / danger) are separate from these four.

Clay (the primary accent) is the one color a tenant can override (see [Theming](#theming-multi-tenant)).

---

## Theming (multi-tenant)

Tokens come in two layers.

**1. Product tokens — fixed.** Defined as CSS custom properties in `app/globals.css` (`@theme`): the Fraunces wordmark, shell chrome, structural neutrals, spacing, radii, and semantic colors. Not overridable by a tenant.

**2. Tenant tokens — per-org.** The **`organizations.branding`** (jsonb) column (Phase 1, #210) is read at runtime since Phase 3 (#212) by `lib/branding.ts`, which falls back per-key to the platform defaults — an invalid `accent` must never discard a valid `display_name`. Validation is per-key and uneven; the table records what each key actually gets:

| Key | Meaning | Validation in `resolveBranding()` |
|---|---|---|
| `display_name` | the church/group name shown within their space (tab title, email sender name) | non-empty after trim; C0/C1 control characters stripped (it reaches `From:` and `Subject:` headers) |
| `logo_url` | their logo (falls back to their name set in Fraunces; not rendered yet — a later phase) | **type-checked only** — any string passes, including `javascript:`. Must be validated before the first render |
| `accent` | a single accent color; drives `--color-brand-primary` **and** the shadcn `--primary` / `--ring` / `--sidebar-primary` / `--sidebar-ring` | strict 6-digit hex — the CSS-injection guard for the `<style>` block and every inline `style=""` in `lib/email/*`. The `/platform` write path additionally enforces ≥ 4.5:1 contrast via `validateAccent()` (see below) |
| `reply_to` | the org's Reply-To address on outbound email (the From: *domain* is separate — platform-wide unless the org has a verified claimed sending domain, see `org_email_domains` / `SENDING_DOMAIN` in CLAUDE.md) | conservative address shape, ≤ 254 chars; anything else falls back to no Reply-To |

**Contrast is enforced on `accent` at the write path (#319).** `--primary` is paired with a hardcoded `--primary-foreground: #FFFFFF` in `app/globals.css`, so a light accent would yield white-on-light on every primary button — `#FFFF00` scores about 1.07:1. `validateAccent()` (`lib/branding.ts`, math in `lib/contrast.ts`) therefore rejects any accent below 4.5:1 against `#FFFFFF` at the `/platform` branding write path. The read path deliberately does **not** check contrast at all: `resolveBranding()` enforces only the hex shape, so a low-contrast accent already sitting in the column keeps rendering rather than 500ing a page or silently swapping to the platform default. That is the accepted consequence of enforcing at the write path only — the check is not retroactive, so any value stored before #319 stays as-is until it is re-saved. Deriving a per-accent foreground remains the right long-term fix for the read side. **Accepted limit:** the ratio is measured against white, not Warm Paper `#F4EEE2` — Clay itself scores 3.93:1 on Warm Paper, which is exactly why deep clay `#8A4227` is the text-safe variant on light grounds; enforcing against Warm Paper would reject the platform's own default accent.

**Accepted limit — the guard covers the solid fill, not the `hover:*/90` state.** Every primary button in the app darkens on hover by compositing the accent at 90% alpha (`hover:bg-brand-primary/90`, ~43 files, plus the shadcn `Button` `default` variant's `hover:bg-primary/90`), and `validateAccent()` measures only the solid color. Clay `#B85C38` passes at 4.540:1 solid, but its 90% composite is `#BF6C4C` over a white card (3.84:1) and `#BE6B49` over Warm Paper (3.90:1) — so white text on a *hovered* primary button sits below 4.5:1 for the platform's own default, and for any accent near the floor. Raising the guard to validate the composite is not the fix: it would reject Clay itself. The fix is a **solid** hover color derived by darkening instead of by alpha — mixing Clay 90% with black gives `#A65332` at 5.38:1, which *improves* on the resting state — which means a new `--color-brand-primary-hover` token and a sweep of every `hover:bg-*/90` including the shadcn variant. That is a design-system change of its own, not a rider on the write-path guard: the hover state is out of compliance today and was before per-org accents existed.

Overriding `accent` produces a *partial* palette by design: `--color-brand-primary-light`, `--color-brand-accent` (Marigold), `--color-brand-warm`, and the email `accentLight` all stay bound to the platform constants rather than inventing a color-derivation scheme. Note the resulting name collision — `branding.accent` overrides `NEXT_PUBLIC_COLOR_PRIMARY`, *not* `NEXT_PUBLIC_COLOR_ACCENT`.

Tenant tokens are resolved for the active org per request and applied to the app root as CSS custom properties in `app/layout.tsx`; there is no per-tenant CSS bundle. Outbound email in `lib/email/*` carries the same identity: the org's `display_name` as the From: display name and `reply_to` as Reply-To.

A tenant may not change layout, typography, structural or semantic colors, or the two42 wordmark on platform-level surfaces (sign-in, "powered by").

---

## Accessibility floor

- Body text ≥ 16px; never below 14px for meaningful content.
- Text contrast ≥ 4.5:1 (≥ 3:1 for large text); Clay is text-safe as body text only in its deep variant (`#8A4227`) on light grounds.
- Touch targets ≥ 44×44px, with generous spacing.
- Never encode meaning in color alone; pair it with a label or icon.
- Assignment/roster UIs show current members by default with an explicit "add" mode — never full toggle lists.
