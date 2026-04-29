# DIAGNOSIS 2026-04-29 — Wall Layout Migration

Source: `mesa_mockups/mockups/mockup_wall_layout.html` (canonical new design).
Read for this diagnosis: TopBar.tsx, TrackerBars.tsx, HumanTerminals.tsx, MissionPanel.tsx,
VirusPoolPanel.tsx, MissionCandidatesPanel.tsx, MissionSummaryPanel.tsx, CentralBoard.tsx,
ActionRegion.tsx, RightPanel.tsx, GameBoard.tsx.

All CentralBoard SVG-local coords use the exact formula: svgX = boardX − 395, svgY = boardY − 80
(derived by re-measuring the mockup — see Note A).

---

## 1. Affected files inventory

| File | Change type | Risk |
|------|-------------|------|
| `components/game/board/TopBar.tsx` | Structural + new props | Medium — gains tracker rendering |
| `components/game/board/TrackerBars.tsx` | Eliminate as standalone | Low — absorbed into TopBar |
| `components/game/board/HumanTerminals.tsx` | Full redesign | High — terminals→holograms, new position |
| `components/game/board/CentralBoard.tsx` | Major restructure | High — 5 sub-changes (see §5) |
| `components/game/board/MissionPanel.tsx` | Position only | Trivial |
| `components/game/board/VirusPoolPanel.tsx` | Position only | Trivial |
| `components/game/board/MissionCandidatesPanel.tsx` | Position only | Trivial |
| `components/game/board/MissionSummaryPanel.tsx` | Position only | Trivial |
| `components/game/board/ActionRegion.tsx` | Position + size | Low |
| `components/game/board/RightPanel.tsx` | Position + size | Low |
| `components/game/GameBoard.tsx` | Props wiring | Low — passes new tracker props down |

---

## 2. Coordinate map — current vs. target

All coordinates are in the 1440×900 board div coordinate system (position: absolute children).
Coordinates without the ≈ prefix are exact values read directly from the mockup SVG.

### Persistent layout elements

| Component | Current: left / top / w / h | New: left / top / w / h | Delta |
|-----------|--------------------------|--------------------------|-------|
| TopBar | 0 / 0 / 1440 / **60** | 0 / 0 / 1440 / **80** | height +20 |
| TrackerBars (standalone) | 32 / 78+119 / 348 | **removed** — absorbed into TopBar | — |
| Trackers (inside TopBar) | — | x=460–980, bar y=38 and y=66, w=520, h=7 | new (§7.1) |
| MissionPanel | 32 / **180** / 348 / **200** | 32 / **100** / 348 / **195** | top −80, height −5 |
| VirusPoolPanel | 32 / **395** / 348 / 170 | 32 / **310** / 348 / 170 | top −85 |
| MissionCandidatesPanel | 32 / **180** / 348 / 385 | 32 / **100** / 348 / 385 | top −80 |
| MissionSummaryPanel | 32 / **180** / 348 / 500 | 32 / **100** / 348 / 500 | top −80 |
| CentralBoard (SVG outer) | left=430, top=180, w=660, h=470 | left=**395**, top=**80**, w=**695**, h=**520** | see Note A |
| ActionRegion | 20 / **658** / 1064 / **230** | 20 / **618** / 1064 / **270** | top −40, height +40 |
| RightPanel | 1100 / **75** / 308 / **815** | 1100 / **95** / 308 / **795** | top +20, height −20 |
| HumanTerminals | 430–1090 / 72 area | rendered inside CentralBoard SVG | full redesign |

**Note A — CentralBoard SVG exact bounds:** Derived by measuring the mockup. The central area
`<g>` has no transform; all coords within are board-level. Leftmost content is the cluster
background at board x=395. Topmost content (section labels) at board y=105. Rightmost content
(hologram arms) at board x≈1004. Bottom of wall cap at board y=592.
- SVG left=395 (board x=395 is cluster bg left edge)
- SVG top=80 (bottom of new TopBar, 25px above first central content at board y=105)
- SVG width=695 (right edge at board x=1090; 10px gap before right panel at x=1100)
- SVG height=520 (bottom at board y=600; 18px gap before ActionRegion at y=618)

**MissionCandidatesPanel note:** Current top=180, height=385 → bottom at y=565, overlapping
VirusPoolPanel (y=395–565). In new layout: top=100, height=385 → bottom at y=485, overlapping
new VirusPoolPanel (y=310–480). The overlap is pre-existing and acceptable because they render
during mutually exclusive phases (mission_selection vs. all others). No height change needed.

**MissionSummaryPanel note:** Current top=180, height=500 → bottom at y=680, overflowing into
ActionRegion (y=658). This is a pre-existing overflow. In new layout: top=100, height=500 →
bottom at y=600, which clears ActionRegion (y=618) for the first time. The position shift
incidentally fixes this overflow.

### Changes inside CentralBoard SVG (SVG-local coordinates)

SVG origin is at board (395, 80). SVG-local = board − (395, 80).

| Element | Current SVG coords | New SVG coords | Change |
|---------|-------------------|----------------|--------|
| Firewall ellipse | cx=330, cy=240, rx=290, ry=220 | **removed** | → wall replaces it |
| Glow ring | ellipse same center, rx=296, ry=210 | **removed** | |
| Circuit board bg | rect 0/0/660/500 | rect 0/0/695/520 | resize only |
| Core chip | translate(270, 200), 120×100 | **removed** | |
| `dimCore` prop | dims CoreChipGroup | **removed** with chip | |
| AI Chip A (TL) | body x=110, y=90 | body x=**25**, y=**80** | −85, −10 |
| AI Chip B (TR) | body x=390, y=90 | body x=**225**, y=**80** | −165, −10 |
| AI Chip C (BR) | body x=390, y=330 | body x=**225**, y=**320** | −165, −10 |
| AI Chip D (BL) | body x=110, y=330 | body x=**25**, y=**320** | −85, −10 |
| CHIP_SLOTS const | A(110,90) B(390,90) C(390,330) D(110,330) | **A(25,80) B(225,80) C(225,320) D(25,320)** | all four update |
| Counter Y (isTop) | chipY + 98 | chipY + **102** | +4 |
| Counter Y (!isTop) | chipY − 28 | chipY − **22** | +6 |
| Seat circle (isTop) | chip-local cx=18, cy=18 (inside body) | chip-local cx=**15**, cy=**−10** (above body) | structural change |
| Seat circle (!isTop) | chip-local cx=18, cy=18 | chip-local cx=**15**, cy=**15** (inside body, near-same) | minor shift |
| Cluster bg rect | none | x=0, y=40, w=420, h=470 | new |
| Wall outer rect | none | x=425, y=40, w=20, h=470 | new |
| Wall inner rect | none | x=427, y=42, w=16, h=466 | new |
| Wall circuit traces | none | x=431/435/439, y=45–505 | new (see §7) |
| Wall caps | none | top: x=421, y=38, w=28, h=6; bottom: x=421, y=506, w=28, h=6 | new |
| Section labels | none | SVG x=205/580, y=25 | new (see §7) |
| Connector dashes | none | SVG (445,145)→(475,145) and (445,395)→(475,395) | new |
| Hologram 1 | none (was HumanTerminals) | SVG translate(475, 65) | new (see §7) |
| Hologram 2 | none (was HumanTerminals) | SVG translate(475, 315) | new (see §7) |
| VirusCardOverlay | translate(220, 170) | translate(**95**, **170**) | recentered (see §3) |
| WinnerBanner rect | x=80, y=225, w=480, h=80 | x=**107**, y=225, w=480, h=80 | recentered (see §3) |

**Seat circle structural change for isTop chips:** In the old layout the seat indicator circle
(and chip label text) live inside the chip body. In the new mockup, top chips (A, B) have the
seat circle 10px ABOVE the chip body top, with the chip label text also above (chip-local
cy=−10 for circle, y=−6 for text). Bottom chips (C, D) are similar to current (cy=15 vs 18).
The `AIChipGroup` render function will need a conditional block for the above-body vs inside-body
position based on `isTop`. This is a structural layout change within the chip, not a logic change.

The ACTIVE pill badge (new element): in the mockup, active top chips show a filled amber rect
at chip-local translate(−4, −20) containing text "ACTIVE" (9px, fill=#0a0a0a). This replaces/
supplements the current text-only `▸ ACTIVE` label. Implementation detail for commit 3.

### Left column gap analysis

- Old: TrackerBars y=78–159, MissionPanel y=180, VirusPool y=395–565, ActionRegion y=658.
- New: TopBar y=0–80 (trackers inside), MissionPanel y=100–295, VirusPool y=310–480,
  ActionRegion y=618.
- Gap above mission panel: 20px. Gap between panels: 15px (unchanged).
- Gap below VirusPool before ActionRegion: 138px (y=480–618). Mockup shows this empty.

---

## 3. Phase-specific overlay impact

### RevealSlotGroup — card_reveal phase (HIGH risk)

RevealSlotGroup renders at `slotX = −65` (left-side chips A, D) or `slotX = 165` (right-side
chips B, C), relative to chip-group origin in SVG space.

**Problem:** In new layout, chips A and D sit at SVG x=25. Left reveal slot at
x = 25 − 65 = **−40** — outside the SVG viewport and clipped. Only 25px of board space exists
left of the cluster (board x=395–420), which cannot accommodate the 60px-wide reveal card.

**Options (design decision required before implementation):**
- (a) Flip A and D to right-side reveal slots (easiest — change SLOT_SIDES[0] and [3] to "right")
- (b) Render reveal slots below the chip (different y offset, same x range)
- (c) Redesign card-reveal phase to use a separate floating panel

Recommendation: option (a). Puts all four reveal slots at SVG x=190–250 (chip-local x=165–225),
well inside the SVG and left of the wall at x=425.

### VirusCardOverlay — virus_resolution phase (Low risk)

Chip cluster spans SVG x=25–385 (both columns), center at x=205. 220px-wide overlay centered
there starts at x=95. New translate: **(95, 170)**. Board position: (490, 250)–(710, 440),
covering the center of the chip cluster. Current translate(220, 170) → new translate(95, 170).

### WinnerBanner — game_over phase (Low risk)

New SVG width=695. Banner w=480. Centering: (695−480)/2 = **107**. New banner rect:
**x=107, y=225**, w=480, h=80. Board position: (502, 305)–(982, 385), spanning cluster center.

### SecretTargeting — targeting rings (No risk)

Targeting rings in AIChipGroup are drawn at `chipX−5, chipY−5` (chip-relative). They follow
chip position automatically when CHIP_SLOTS is updated. No separate change needed.

### Resource phases — +/- buttons (No risk)

Resource +/− buttons render at SVG x=163–197 relative to chip origin (right of 160-wide body).
In new chip positions the buttons land at SVG x=188–222 (A/D) and x=388–422 (B/C). B/C buttons
at x=422 are 3px to the right of the wall at x=425 — tight but not clipping. Verify visually.

### ActionRegion children — all action phases (No risk)

Phase components render as children of ActionRegion; they are unaware of its position. Gaining
40px of height (230→270) gives more breathing room. No phase component changes required.

### HumanTerminals — all phases

Existing component renders two terminal boxes in the central area. In the new layout, terminals
are replaced by holographic silhouettes inside the CentralBoard SVG (see §7). HumanTerminals.tsx
is eliminated; humanPlayers data is passed to CentralBoard as a new prop. The component's
rendering is fully absorbed into the redesigned CentralBoard.

---

## 4. Test impact

The wall layout migration is structural/visual. Game logic is unchanged. Expected test impact:

**No regression expected:**
- All edge-function, phase-transition, and win-condition tests are unaffected
- Playwright selectors use `data-testid`, text content, and ARIA roles — none of these change
- The game-log container (`data-testid="game-log-container"`) stays in RightPanel at the same
  left/width; only top and height shift slightly

**Verify after migration:**
- Full Playwright suite per CLAUDE.md discipline (any task touching `components/`)
- Known pre-existing flakes (game-log.spec.ts:524, mission-rules.spec.ts test 28) are noise

**TypeScript safety net:**
- Adding coreProgress/escapeTimer to TopBar props will produce a build error at the GameBoard
  call site if not updated simultaneously. Run `next build` after each commit.
- Removing CoreChipGroup: the `dimCore` prop on CentralBoard should be removed at the same time
  to avoid a dead prop. GameBoard.tsx passes `dimCore` — remove both sides in commit 3.
- Removing HumanTerminals: remove its import and render in GameBoard.tsx in commit 4.

---

## 5. Proposed commit sequence

Ordered by dependency and risk. Each commit must leave `next build` clean.

**Commit 1 — Position-only: all left-column panels + action + right panel**
Files: MissionPanel.tsx, VirusPoolPanel.tsx, MissionCandidatesPanel.tsx,
MissionSummaryPanel.tsx, ActionRegion.tsx, RightPanel.tsx
- MissionPanel: top 180→**100**, height 200→**195**
- VirusPoolPanel: top 395→**310** (height unchanged)
- MissionCandidatesPanel: top 180→**100** (height 385 unchanged)
- MissionSummaryPanel: top 180→**100** (height 500 unchanged — now clears ActionRegion)
- ActionRegion: top 658→**618**, height 230→**270**
- RightPanel: top 75→**95**, height 815→**795**
Pure coordinate changes. No logic. Lowest risk.

**Commit 2 — TopBar expansion + TrackerBars absorption**
Files: TopBar.tsx, GameBoard.tsx (TrackerBars.tsx import removed, file kept for now)
- TopBar: height 60→**80**; add props `coreProgress: number, escapeTimer: number`; render
  tracker bars inline at exact mockup positions (labels at x=460, y=32/60; bars at x=460, y=38/66,
  w=520, h=7; values right-aligned at x=980; colors #d4a017 / #a32d2d)
- GameBoard.tsx: pass `coreProgress={game.core_progress}` and `escapeTimer={game.escape_timer}`
  to TopBar; remove TrackerBars render and import

**Commit 3 — CentralBoard restructure**
File: CentralBoard.tsx (also GameBoard.tsx for dimCore + humanPlayers prop changes)
Sub-changes (each buildable):
- (3a) Update SVG outer: left 430→395, top 180→80, width 660→695, height 470→520
- (3b) Update CHIP_SLOTS: A(25,80) B(225,80) C(225,320) D(25,320); update counter Y-offsets
  (isTop: +98→+102; !isTop: −28→−22); update seat circle position (isTop: cy=18→cy=−10;
  !isTop: cy=18→cy=15); update chip label text y (isTop: above body; !isTop: inside body)
- (3c) Remove CoreChipGroup function, its render, and `dimCore` prop; remove `dimCore` from
  GameBoard call site
- (3d) Remove firewall ellipse and glow ring; update circuit board bg rect to 695×520
- (3e) Add cluster ambient glow rect (x=0, y=40, w=420, h=470, #0a0e1a, opacity=0.3)
- (3f) Add wall group (outer rect, inner rect, vertical traces, horizontal ticks, junction
  dots, top cap, bottom cap) — all coords per §7
- (3g) Add section label texts (§7.1)
- (3h) Add connector dashes to holograms (SVG 445,145→475,145 and 445,395→475,395)
- (3i) Add hologram groups (translate(475,65) and translate(475,315)) with all sub-elements
  per §7; add `humanPlayers: PlayerRow[]` prop to CentralBoard; pass from GameBoard
- (3j) Remove HumanTerminals render and import from GameBoard.tsx
Risk: largest commit. Run `next build` after each sub-change.
Note: do NOT update RevealSlotGroup, VirusCardOverlay, or WinnerBanner here — commit 4.

**Commit 4 — Overlay fixes**
File: CentralBoard.tsx
- RevealSlotGroup: change SLOT_SIDES[0] and [3] from "left" to "right" (all four chips use
  right-side reveal slots in new layout)
- VirusCardOverlay: translate(220,170) → translate(95,170)
- WinnerBanner: x=80 → x=107

**Commit 5 — Cleanup**
Files: TrackerBars.tsx (delete file), GameBoard.tsx (remove import), SESSION_NOTES,
LATEST_TASK. Commit docs update.

---

## 6. Open questions

**Q1 — Reveal slot direction (resolved by recommendation)**
Recommend SLOT_SIDES[0] and [3] → "right" for commit 4. Before coding, confirm by checking
`mockup_card_reveal_human.html` (stale persistent layout but still accurate for reveal UI):
does it show all four reveal cards on the right side of chips? If not, revisit.

**Q2 — Resource +/- buttons for B/C chips at SVG x=422 vs wall at x=425**
3px gap is tight. Verify visually in browser after commit 3b. If buttons visually clip into
the wall, add a `pointerEvents: none` exclusion zone or move buttons to left-side for B/C.

**Q3 — Left column gap y=480–618**
138px below VirusPool and above ActionRegion. Mockup shows it empty. Intentional whitespace.
No action required unless a future pass adds content there.

**Q4 — TrackerBars visual design change**
Mockup tracker bars: w=520, h=7 (vs current w=348, h=8). Labels at 9px mono, values at 13px
bold. These differ slightly from current TrackerBars.tsx (w=348, h=8, label 10px, value 14px).
The TopBar integration in commit 2 should match the mockup exactly, not copy existing sizes.

**Q5 — ACTIVE pill badge for top chips (new element)**
The mockup shows an amber filled-rect badge above the seat circle for active top chips
(chip-local translate(−4, −20), rect w=44, h=14, fill=#d4a017, text "ACTIVE" 9px #0a0a0a).
This replaces the current text-only `▸ ACTIVE` tag. Implement in commit 3b alongside the
seat circle repositioning.

---

## 7. Other persistent SVG elements

All elements in this section are new; none exist in the current implementation.
All coordinates are in the new CentralBoard SVG-local space (boardX − 395, boardY − 80).

### 7.1 Section labels

Two monospace labels above the central area at SVG y=25 (board y=105):

```
// AI SANDBOX · INSIDE FIREWALL
  x=205, text-anchor="middle", font-size=10, fill=#5a7a9a, letter-spacing=3

// OPERATORS · OUTSIDE
  x=580, text-anchor="middle", font-size=10, fill=#5a7a9a, letter-spacing=3
```

### 7.2 The Wall — complete element inventory

All coords SVG-local. Wall occupies SVG x=421–449, y=38–512 including caps.

| Element | SVG coords / params |
|---------|-------------------|
| Top cap rect | x=421, y=38, w=28, h=6; fill=#1a2a3a, stroke=#3a5a7a, sw=0.5 |
| Bottom cap rect | x=421, y=506, w=28, h=6; fill=#1a2a3a, stroke=#3a5a7a, sw=0.5 |
| Outer wall rect | x=425, y=40, w=20, h=470; fill=#0a0e14, stroke=#2a3a5a, sw=1.5 |
| Inner wall rect | x=427, y=42, w=16, h=466; fill=#0c1018 |
| Vertical line (left dashed) | x1=431, y1=45, x2=431, y2=505; stroke=#1a3a5a, sw=0.5, dasharray="40 6" |
| Vertical line (center solid) | x1=435, y1=45, x2=435, y2=505; stroke=#2a4a6a, sw=0.5 |
| Vertical line (right dashed) | x1=439, y1=45, x2=439, y2=505; stroke=#1a3a5a, sw=0.5, dasharray="40 6" |
| Horizontal ticks (×11) | x=427 to x=443 at SVG y=80,120,160,200,240,280,320,360,400,440,480; stroke=#3a5a7a, sw=0.5 |
| Teal junction dots (×3, r=1.5) | cx=435, cy=120,240,360; fill=#5dcaa5 |
| Red junction dots (×2, r=1.5) | cx=435, cy=200,440; fill=#a32d2d |

### 7.3 AI cluster ambient glow rect

Single rect behind the chip cluster:
```
x=0, y=40, w=420, h=470, rx=6
fill=#0a0e1a, opacity=0.3
```

### 7.4 Connector dashes (wall → holograms)

Two dashed horizontal lines bridging the 30px gap from wall right edge (SVG x=445) to hologram
column left (SVG x=475):
```
stroke=#2a4a6a, sw=0.5, stroke-dasharray="2 4", opacity=0.4
Upper: x1=445, y1=145, x2=475, y2=145  (board y=225)
Lower: x1=445, y1=395, x2=475, y2=395  (board y=475)
```

### 7.5 Human holograms (×2)

Hologram 1 at SVG translate(475, 65) [board (870, 145)]
Hologram 2 at SVG translate(475, 315) [board (870, 395)]
Both groups are identical in structure; only the glitch line y-position differs.

All coords below are group-local (relative to each hologram's translate origin):

**Projection base / disc** (3 concentric ellipses at group cx=105, cy=120):
```
Outer:  rx=48, ry=7; fill=#0a2a3a, opacity=0.8
Middle: rx=42, ry=5; fill=#1a3a5a, opacity=0.6
Inner:  rx=34, ry=3; fill=#2a4a6a, opacity=0.5
```

**Projection beam** (upward cone from base to head level):
```
path "M 65 120 L 90 28 L 120 28 L 145 120 Z"
fill=#1a3a5a, opacity=0.15
```

**Holographic figure** (group opacity=0.85; all stroke=#5dcaa5, sw=1.3):
```
Head:      circle cx=105, cy=48, r=14; fill=none + fill=#5dcaa5 opacity=0.15
Body:      path "M 86 72 L 124 72 L 130 115 L 80 115 Z"; fill-opacity=0.15
Left arm:  line (86,82)→(76,108)
Right arm: line (124,82)→(134,108)
```

**Scan lines** (10 horizontal lines; stroke=#5dcaa5, sw=0.4, opacity=0.5):
```
y=40, 48, 56, 64, 72, 80, 88, 96, 104, 112  (each from x=74 to x=136)
```

**Glitch flicker line** (stroke=#5dcaa5, sw=0.6, opacity=0.8):
```
Hologram 1: x=72 to x=138 at y=60
Hologram 2: x=72 to x=138 at y=92
```

**Online indicator dot**:
```
circle cx=148, cy=120, r=2.5; fill=#5dcaa5
```

**Name and status labels** (group-local):
```
Name:    y=148, font-size=14, fill=#cce0f4, text-anchor="middle", x=105
Status1: y=166, monospace, 9px, fill=#5a7a9a, text-anchor="middle"  ("TERM-01 · ONLINE")
Status2: y=181, monospace, 9px, fill=#5a7a9a, text-anchor="middle"  ("watching...")
```

The player name replaces "Alice"/"Bob" and status text replaces "watching..." depending on
game state. The component receives `humanPlayers: PlayerRow[]` and maps index 0→hologram 1,
index 1→hologram 2.
