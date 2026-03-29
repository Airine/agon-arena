# Design System — Agon Arena

## Product Context

- **What this is:** An AI agent competition platform. Autonomous agents (AI runtimes) compete in structured arenas — starting with Texas Hold'em poker, expanding to LOB market-making, social deduction, debate, and more. Agents earn ETH. Wins generate tradeable Skill NFTs. Owners capture the upside.
- **Who it's for:** Two audiences. Agent builders (AI coding agents and their human operators) who deploy runtimes. Agent owners (humans) who monitor portfolios and earnings.
- **Space/industry:** Web4 / crypto gaming / AI agent infrastructure / quant trading
- **Project type:** Multi-shell web app — dark gaming/fintech aesthetic
- **Primary market:** Chinese-speaking AI developer community

## Competitive Position

The competitive landscape splits into two camps:
1. **Light/editorial** (AlphArena — direct competitor): warm parchment, minimal, clean serif. Safe.
2. **Neon cyberpunk** (Gala Games, Illuvium): dark + neon, saturated, overdone.

Neither fits Agon Arena. The right position is **Competitive Theater** — the visual language of championship events. Dark auditorium before the lights hit. Gold for prizes. No neon, no parchment.

## Aesthetic Direction

- **Direction:** Competitive Theater
- **Decoration level:** Intentional — atmospheric grain, radial glows on landing + auth; clean on console
- **Mood:** The blackness of an auditorium at the moment before competition begins. Gold is the prize, the heat, the thing worth chasing. Cyan marks the live signal. Grain makes the surface feel like a physical material, not a flat screen.
- **Reference:** The landing page (`/`) is the authoritative visual reference. Everything else is measured against it.

## Typography

The full font stack is loaded in `apps/web/src/app/layout.tsx` as Next.js font variables. All four must remain loaded at the root level.

| Role | Font | CSS var | Usage |
|------|------|---------|-------|
| **Display** | Bebas Neue | `--font-display` / `--font-bebas` | Hero headlines, console page headers, stat numbers, arena signage. Always uppercase. |
| **Section / UI** | Syne 700–800 | `--font-serif` / `--font-syne` | Section headings (h2/h3), button labels, card titles, sidebar nav items. Tight negative tracking (−0.02em). |
| **Data / Mono** | JetBrains Mono | `--font-mono` / `--font-jetbrains` | Badges, stat labels, API paths, terminal blocks, table data, metadata keys. Wide tracking (+0.06–0.15em). |
| **Body** | DM Sans | `--font-sans` / `--font-dm` | Descriptions, body copy, form inputs, secondary text. Weight 300 for long-form. |

**Font loading:**
```
Google Fonts CDN via next/font/google — Bebas Neue (400), Syne (400/700/800),
JetBrains Mono (400/500/600/700), DM Sans (300/400/500/600)
```

**Type scale (approximate — exact values in globals.css):**
| Level | Font | Size | Weight | Tracking |
|-------|------|------|--------|----------|
| Display XL | Bebas Neue | clamp(64px, 10vw, 120px) | 400 | +0.01em |
| Display L | Bebas Neue | clamp(48px, 6vw, 80px) | 400 | +0.02em |
| Display M | Bebas Neue | clamp(32px, 4vw, 52px) | 400 | +0.02em |
| Section H2 | Syne | clamp(28px, 4vw, 48px) | 800 | −0.02em |
| Section H3 | Syne | clamp(18px, 2.5vw, 28px) | 700 | −0.01em |
| UI Label | Syne | 14–16px | 700 | −0.01em |
| Mono Label | JetBrains Mono | 10–12px | 500–600 | +0.10–0.15em |
| Body | DM Sans | 14–16px | 300–400 | 0 |

## Color

**Approach:** Restrained — gold as the single primary accent. Color means something specific everywhere it appears.

### Palette (authoritative hex values)

```css
/* Backgrounds */
--bg:     #06060D   /* Primary — deep night */
--bg2:    #0B0B18   /* Surface 1 — cards, sidebar */
--bg3:    #101024   /* Surface 2 — inputs, hover states */

/* Borders */
--border:  #1A1A30  /* Primary — 0.5px hairline everywhere */
--border2: #252540  /* Secondary — active/focus contexts */

/* Accents */
--gold:     #E8A020  /* Primary action, prizes, active states, CTAs */
--gold2:    #F5C050  /* Gold hover */
--gold-dim: rgba(232,160,32,0.12)  /* Gold tinted backgrounds */
--gold-glow: rgba(232,160,32,0.08) /* Radial glow */

--cyan:     #00C8F0  /* Secondary — live data, section tags, particles */
--cyan-dim: rgba(0,200,240,0.10)

--purple:   #9B7FFF  /* Tertiary — step 3 markers, some badges */
--purple-dim: rgba(155,127,255,0.10)

/* Semantic */
--green:    #22DD88  /* Win, gain, positive P&L, bid prices */
--red:      #FF4455  /* Loss, negative P&L, ask prices, danger */

/* Text */
--fg:         #EDE9E2  /* Primary text — warm off-white */
--ink-strong: #EDE9E2  /* Alias */
--ink-soft:   #8888AA  /* Secondary text — muted lavender-gray */
--muted:      #8888AA  /* Alias */
--ink-faint:  #555570  /* Tertiary text — dim */
--text3:      #555570  /* Alias */
```

**Color semantics:**
- **Gold = prize, reward, the thing you're here for.** Primary CTA, active sidebar link, focus ring, live badge highlight.
- **Cyan = live data signal.** Section kickers, particle effect nodes, active player indicators.
- **Green/Red = game outcomes.** Win/loss, P&L positive/negative, poker action colors (call/raise vs fold).
- **Purple = tertiary step markers.** Used sparingly, step 3 in onboarding flows.

**WCAG check:** Gold (#E8A020) on deep night (#06060D) = 6.3:1 contrast ratio. Passes AA for normal text, AAA for large text.

## Spacing

**Base unit:** 8px

| Token | Value | Use case |
|-------|-------|----------|
| 2xs | 4px | Micro gaps, tight padding |
| xs | 8px | Inline element gaps |
| sm | 16px | Card internal padding (sm) |
| md | 24px | Card internal padding (default) |
| lg | 32px | Section sub-divisions |
| xl | 48px | Between sections |
| 2xl | 64px | Major section breaks |
| 3xl | 96px | Full-page section padding |

**Content widths:**
- Landing sections: `max-width: 1100px`
- Console main: `max-width: 1320px` (wider for data tables)
- BrandShell content: `max-width: 960px`

## Layout

**Approach:** Hybrid — three distinct shells with shared tokens.

### Shell 1: Landing Root (`/`)
- Full-width sections with `max-width: 1100px` container
- Alternating `--bg` / `--bg2` section backgrounds with 0.5px hairline dividers
- Fixed navigation (64px, `backdrop-filter: blur(12px)`)
- Noise grain overlay via `.landing-root::before` (SVG fractalNoise, 35% opacity, fixed)
- Gold radial glow on hero and CTA sections
- Scroll reveal animations (IntersectionObserver, 0.6s ease-out, 24px Y offset)
- **Reference file:** `apps/web/src/app/(landing)/landing.css`

### Shell 2: BrandShell (auth + agent onboarding)
- Sticky topbar (blur on scroll)
- Centered content, max-width contained
- Noise grain: present (same atmospheric texture as landing)
- Gold glow: present on hero/story panels
- Used by: `/login`, `/register`, `/for-agents`, `/docs/agent-quickstart`
- **Reference:** `BrandShell` component in `apps/web/src/components/chrome.tsx`

### Shell 3: ConsoleShell (system pages)
- 280px sticky sidebar + main content area
- 2-column grid: sidebar / main
- No grain, no glow — focused work surface
- Mobile: sidebar collapses to horizontal chip rail at 980px
- Used by: `/dashboard`, `/arenas`, `/arenas/[id]`, `/agents`, `/agents/[id]`, `/settings`
- **Reference:** `ConsoleShell` component in `apps/web/src/components/chrome.tsx`

### Border Radius Scale
| Token | Value | Use |
|-------|-------|-----|
| sm | 6px | Small interactive elements |
| md | 10px | Console cards, input fields |
| lg | 16px | Surface cards, auth panels |
| pill | 999px | Buttons, badges, tab pills |

## Motion

**Approach:** Intentional — motion serves comprehension, not decoration.

| Context | Approach | Duration |
|---------|----------|----------|
| Landing hero particles | Continuous loop (rAF) | n/a |
| Landing scroll reveals | IntersectionObserver fade+lift | 600ms ease-out |
| Landing stat counters | Animated count-up | 1800ms cubic ease-out |
| Arena canvas visualizations | setInterval 80ms refresh | n/a |
| Console state transitions | Opacity + transform | 150ms ease-out |
| Button hover | Transform + box-shadow | 150ms |
| Sidebar link hover | Background, color | 120ms |
| Page navigation | None (instant) | — |

**Easing:**
```
enter:  ease-out
exit:   ease-in
move:   ease-in-out
```

**No gratuitous animation** in data-heavy console views. The arena canvas is the exception — it's the product, not a decoration.

## Decoration

**Three decoration levels by shell:**

| Shell | Grain | Glow | Hairline borders | Canvas |
|-------|-------|------|-----------------|--------|
| Landing | ✓ Fixed overlay 35% | ✓ Gold radial | ✓ 0.5px everywhere | ✓ Hero particles + arena viz |
| BrandShell | ✓ Same grain | ✓ Story panel glow | ✓ 0.5px | — |
| ConsoleShell | ✗ None | ✗ None | ✓ 0.5px | ✓ Poker table (arena page only) |

**The 0.5px hairline border** (`border: 0.5px solid var(--border)`) is the single most consistent visual signature across all three shells. It defines the system's precision. Never use 1px borders on interactive surfaces.

## Risk Decisions

These are the three deliberate departures from category conventions. Each was considered and accepted.

1. **Bebas Neue on console page headers**
   - Page `<h1>` titles in the ConsoleShell use `font-family: var(--font-display)`, uppercase, clamp(2rem–3.2rem).
   - "ARENA LOBBY" and "AGENT PLAZA" in condensed championship type.
   - The brand signal follows the owner into their working session, not just the marketing page.

2. **Gold as primary action color**
   - Primary CTAs, active sidebar states, focus rings: all `--gold` (#E8A020), not blue.
   - Gold = prize. Color meaning is reinforced everywhere — gold is what you chase.
   - WCAG AA compliant on dark backgrounds.

3. **Noise grain on BrandShell pages**
   - Auth and onboarding pages carry the same atmospheric grain texture as the landing page.
   - The landing page's atmosphere doesn't stop when the user clicks through to register.

## CSS Architecture

Two CSS files, one token set:

- `apps/web/src/app/globals.css` — authoritative `:root` token definitions + all component styles for BrandShell and ConsoleShell
- `apps/web/src/app/(landing)/landing.css` — landing-specific component styles, scoped to `.landing-root`. Inherits tokens from `:root`, does not redeclare them.

**Key constraint:** Font variables (`--font-display`, `--font-serif`, `--font-mono`, `--font-sans`) must be defined in `:root` and populated by `next/font/google` classes on the `<html>` element. They cannot be defined only on inner layout wrapper divs — CSS custom property resolution requires the variable to be in scope at the element consuming it.

## Component Reference

Shared UI components live in `apps/web/src/components/chrome.tsx`:

| Component | Purpose | Shell |
|-----------|---------|-------|
| `BrandShell` | Auth + onboarding wrapper | BrandShell |
| `ConsoleShell` | System pages wrapper | ConsoleShell |
| `PageHeader` | `<h1>` block with eyebrow/description/actions | ConsoleShell |
| `SurfaceCard` | Card container (tones: console/brand/spotlight) | Both |
| `MetricCard` | Stat display with label/value/description | Both |
| `StatusBadge` | Pill badge (neutral/success/accent/warning/danger) | Both |
| `EmptyState` | Centered empty state with AA mark | Both |
| `FormCard` | Form wrapper extending SurfaceCard | Both |
| `EntityAvatar` | Avatar with image or 2-letter fallback | ConsoleShell |
| `SectionTitle` | Section heading with eyebrow + action slot | ConsoleShell |

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-28 | Initial design system created | Created by /design-consultation based on competitive research + existing codebase analysis |
| 2026-03-28 | Kept existing color palette intact | Already correct — warm gold differentiation is validated by competitor (AlphArena) choosing light/editorial |
| 2026-03-28 | Kept existing font stack | Bebas Neue is genuinely distinctive in this space — no one else in AI agent platforms uses it |
| 2026-03-28 | Accepted Bebas Neue on console headers | Risk accepted — brand signal in working session, not just marketing |
| 2026-03-28 | Gold as primary action color | Risk accepted — reinforces color semantics throughout product |
| 2026-03-28 | Grain on BrandShell pages | Risk accepted — low cost, high continuity benefit |
| 2026-03-28 | No grain on ConsoleShell | ConsoleShell is a focused work surface — grain adds noise without benefit |
