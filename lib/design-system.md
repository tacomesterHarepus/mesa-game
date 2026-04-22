# MESA Design System

## Theme
Dark grey base, warm amber accents, medium retro CRT feel — clean and playable.

## Colors

### Backgrounds
| Token | Hex | Tailwind class |
|-------|-----|----------------|
| base | `#1c1c1c` | `bg-base` |
| surface | `#141414` | `bg-surface` |
| deep | `#0f0f0f` | `bg-deep` |

### Accent
| Token | Hex | Tailwind class |
|-------|-----|----------------|
| amber | `#e8a020` | `text-amber` / `bg-amber` / `border-amber` |
| amber-dim | `#9a6510` | `text-amber-dim` / `bg-amber-dim` |
| amber-border | `#4a3000` | `border-amber-border` |

### Neutral
| Token | Hex | Tailwind class |
|-------|-----|----------------|
| border (default) | `#2a2a2a` | `border-border` |
| primary text | `#e0e0e0` | `text-primary` |
| muted text | `#666666` | `text-muted` |
| faint text | `#333333` | `text-faint` |

### Card types
| Type | Text | Background | Border |
|------|------|------------|--------|
| Compute | `text-compute` (#4a9eff) | `bg-compute-bg` (#050d1a) | `border-compute-line` (#1e4a8a) |
| Data | `text-data` (#3dba68) | `bg-data-bg` (#050f0a) | `border-data-line` (#1a6b35) |
| Validation | `text-validation` (#b06aff) | `bg-validation-bg` (#0e0818) | `border-validation-line` (#5a2e8a) |
| Virus | `text-virus` (#c0392b) | `bg-virus-bg` (#1a0000) | `border-virus-line` (#7a1515) |

## Typography

| Use | Font | CSS variable |
|-----|------|-------------|
| UI body | Inter | `var(--font-inter)` / `font-sans` |
| Stats, trackers, labels, game log | Share Tech Mono | `var(--font-mono)` / `font-mono` |

Label pattern: `label-caps` utility class → uppercase, letter-spacing, Share Tech Mono, 11px.

## Trackers

- **Core Progress**: amber pips only. Never red.
- **Escape Timer**: crimson pips only.
- Pip style throughout — not bars.

## Mission Progress

- Pips + `X/Y` count per resource type (monospace).
- Compute pips: `text-compute`
- Data pips: `text-data`
- Validation pips: `text-validation`
- Pip becomes unfilled when a virus removes a contribution.

## Cards

- Each type uses its full color scheme (bg, border, text).
- Scanline overlay: `.card-scanlines` CSS class (cards only — never the full board UI).
- Hand: ~80×112px. Played/revealed: larger.
- Virus cards: name + effect text in virus color scheme.

## Component Patterns

| Pattern | Style |
|---------|-------|
| Active player | `border-amber` + `text-amber` name |
| Human players | neutral grey, `HUMAN` label always visible |
| Game log | `font-mono`, `bg-deep`, color-coded by event |
| Mission badges | card type colors |

## Retro Details (medium)

- `font-mono` for all numbers, stats, labels, game log.
- Pip trackers throughout.
- `.card-scanlines` on cards only.
- No heavy CRT on main board.
