# MedVerse LMS — Design Tokens

Canonical visual tokens for the production UI polish. **This is not a redesign
spec** — tokens encode the accepted appearance so shell surfaces, type hierarchy,
borders, and brand accents stay consistent without inventing new looks.

Product brand law (navy / teal sampling, logo variants, Light/Dark/System) remains
in [architecture.md](architecture.md). Theme values live in `src/app/globals.css`.

## Source of truth

| Layer | Location | Role |
|---|---|---|
| Leaf values + semantic aliases | `src/app/globals.css` (`:root` / `.dark`) | Hex / mix definitions; `--student-*`, `--brand-*`, `--color-*` |
| Tailwind theme bridge | `src/app/globals.css` (`@theme inline`) | Maps leaves → utilities (`bg-canvas`, `text-ink`, `shadow-elevated`, …) |
| Composition utilities | `src/app/globals.css` (`@layer utilities`) | `.surface-card`, `.canvas-atmosphere`, `.shell-header-bar`, `.eyebrow`, … |
| shadcn primitives | `--background`, `--primary`, `--border`, `--radius`, … | Component library defaults; do not fork a second system |

Do **not** introduce a third-party design-system package. Do **not** invent
alternative brand hexes — re-sample from `public/logo-icon.png` if the logo changes
(see architecture Brand section).

## Naming conventions

1. **Leaf / brand** — `--brand-navy`, `--brand-teal`, `--brand-teal-ink`, `--student-canvas`, `--student-surface`, `--student-ink`, `--student-elevated-shadow`. Widely referenced; keep stable.
2. **Semantic aliases** — `--color-canvas`, `--color-surface`, `--color-ink`, `--color-brand`, `--color-danger`, `--color-success`, `--shadow-elevated`. Prefer these in new CSS/utilities.
3. **Tailwind utilities** — `@theme` exposes semantic colors without the `--color-` prefix: `bg-canvas`, `text-ink`, `text-brand-ink`, `bg-brand-strong`, `shadow-elevated`.
4. **Composition classes** — multi-property recipes that match production chrome (atmosphere, header bar, eyebrows). Prefer these over re-copying mixes.

Legacy `var(--student-ink)` / `var(--brand-teal)` call sites remain valid; migrate
high-traffic shells first. Do not mass-rewrite every page for token purity.

## Canonical semantic set

| Token | Light (prod) | Dark | Use for |
|---|---|---|---|
| `--color-canvas` / `bg-canvas` | `#f4f6f8` | `#050b16` | Page / shell canvas |
| `--color-surface` | `#ffffff` | `#0b1528` | Cards / elevated panels |
| `--color-surface-muted` | `--muted` | `--muted` | Quiet fills |
| `--color-ink` / `text-ink` | `#072855` | `#f1f5f9` | Primary readable text |
| `--color-ink-muted` | `--muted-foreground` | same | Secondary copy |
| `--color-brand` / `text-brand` | `#05aea9` | `#05aea9` | Logo teal accents |
| `--color-brand-ink` | `#037a76` | `#5ee0da` | Teal **text** on surfaces |
| `--color-brand-strong` | `#072855` | `#072855` | Navy hero / sidebar brand fill |
| `--color-brand-contrast` | `#ffffff` | `#ffffff` | Text/icons on navy heroes |
| `--color-danger` | `--destructive` | same | Errors / destructive actions |
| `--color-success` | `#15803d` | `#4ade80` | Status success only |
| `--shadow-elevated` | student soft stack | dark soft stack | Card elevation |
| `--surface-tint` / `.surface-tint` | navy 4% on surface | same mix | Card header wash |
| `--surface-tint-strong` | navy 5% on surface | same mix | Section band wash |
| `--layout-content-max` | `72rem` | — | Student content max width |
| `--layout-content-max-wide` | `80rem` | — | Admin content max width |
| `--space-page-x` / `-md` | `1rem` / `2rem` | — | Shell horizontal padding |
| `--radius` (+ `@theme` sm…4xl) | `0.625rem` base | — | Control / card radii |
| `--nav-active-inset` / `.nav-active-rail` | teal 3px inset | same | Active nav rail |

shadcn tokens (`--background`, `--card`, `--primary`, `--border`, …) remain the
defaults for buttons, inputs, dialogs, and other primitives.

## Semantic usage rules

- **Canvas vs background:** Student/admin shells use `--color-canvas` /
  `.canvas-atmosphere`. Generic shadcn pages may use `--background` (`#f8fafc` light).
  Do not force one value onto both.
- **Ink vs foreground:** Prefer `text-ink` / `--color-ink` for LMS content hierarchy.
  Never paint body copy with raw `--brand-navy` in dark mode.
- **Brand teal:** Logo sample (`--brand-teal`) for fills/accents; readable text uses
  `--brand-teal-ink` / `text-brand-ink`.
- **Primary button fill:** `--primary` is slightly deeper than logo teal on light
  mode for white-label contrast — do not replace with `--brand-teal` without checking AA.
- **Success:** `--color-success` is for subscription / confirmation status. Practice
  MCQ “correct” emerald/green treatments stay **local** (answer semantics ≠ brand status).
- **Eyebrows:** `.eyebrow` (11px / 0.16em), `.eyebrow-wide` (0.2em, landing/auth),
  `.section-eyebrow` (13px / 0.14em). Do not invent a fourth tracking scale without need.
- **Cards:** Prefer `surface-card` + `border-border/80` + `shadow-none` when matching
  the polished shell cards; base `Card` already uses `--shadow-elevated`.

## When a component may define a local value

Allowed without promoting to a global token:

- One-off chart series colors beyond `--chart-1…5`
- PDF highlight yellow (`#fde047`) and annotation tools
- Exam / practice answer correctness greens and distractor reds
- Inline styles in `global-error.tsx` (must render if CSS fails to load)
- Manifest / `themeColor` hexes required by platform APIs
- Densely interactive builders (CSV import tables, admin editors) with situational
  Tailwind greens/ambers that are not shell chrome

Promote a value to `globals.css` only when it appears in **multiple shells** or
shared components and changing it should ripple intentionally.

## Light / dark / system

- Modes: **Light / Dark / System** (SPEC FREEZE in architecture).
- `.dark` overrides the same token names; components should consume tokens, not
  hard-code separate light hexes.
- Sidebar stays navy-forward in both modes; content chrome uses
  `.shell-header-bar` so tools remain readable on the light/dark canvas.
- System mode is handled by the existing theme provider; tokens do not add a
  third palette.

## Responsive conventions

- Breakpoints: Tailwind defaults (`sm`/`md`/`lg`…). No custom breakpoint tokens.
- Shell padding: `--space-page-x` → `md:` `--space-page-x-md` (matches `px-4` /
  `md:px-8`).
- Content width: student `--layout-content-max` (`max-w-6xl`); admin wide
  `--layout-content-max-wide` (`max-w-7xl`). Exam player keeps its own `max-w-6xl`
  framing intentionally.
- Mobile bottom nav clearance stays in the student shell
  (`pb-[calc(4.5rem+env(safe-area-inset-bottom))]`) — do not collapse into a
  shared token until admin/student padding truly unify.

## Migration guidance

1. New UI: use semantic utilities (`text-ink`, `bg-canvas`, `.eyebrow`, …).
2. Touched shell files: replace `text-[var(--student-ink)]` → `text-ink` (etc.).
3. Leave deep feature pages alone unless editing them for another reason.
4. Never “fix” contrast by swapping teal-ink for logo teal on light text.

## Related

- [architecture.md](architecture.md) — Brand + theme modes
- `src/app/globals.css` — implementation
- `src/components/ui/*` — shadcn primitives consuming theme colors
