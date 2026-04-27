# UX_DESIGN.md

Authoritative design reference for MESA's player-facing UI in v0.1.

This document captures locked design decisions from the board redesign session. It is the single source of truth when implementing UI work. Mockup HTML files referenced throughout live in `/docs/mockups/` and should be opened alongside this document.

## How to use this doc

- **Start here** when implementing any phase. Read the relevant phase section, then open the corresponding mockup file as a visual target.
- **Decisions are locked unless re-opened explicitly.** If something here conflicts with what feels right while building, raise it in chat — don't silently drift.
- **Mockups show what should be on screen, not how it should feel to use.** Animations, hover states, transitions, click feedback are implementation-side. Use existing app conventions unless this doc says otherwise.
- **Out-of-scope work is flagged** — these are explicit deferrals, not gaps.

---

## 1. Visual register

MESA's visual identity is **air-gapped AI research lab**, not medical, not fantasy, not corporate-clean. Tech/sci-fi register — terminal-style monospace headers, dark background, restrained color palette, low-contrast subdued ambient elements with high-contrast active elements.

The interface is **desktop-only for v0.1**. Target resolution 1440×900. Mobile responsiveness is out of scope.

**Dual-target constraint**: the UI must read both as a digital interface AND as a physical board game (the long-term vision is a physical version with companion app). This means: clear spatial relationships, named regions, persistent placements that don't shift, and avoid web-first patterns like sliding panels or modal stacks where alternatives exist.

## 2. Color palette and semantic conventions

| Color | Hex | Semantic |
|---|---|---|
| Amber | `#d4a017` | "You should act" / your turn / active player / primary action affordance |
| Amber light | `#f4d47e` | Active text on amber backgrounds |
| Amber dim | `#a87a17` | Subtitles, secondary text in active regions |
| Amber bg | `#3a2e1a` | Filled amber buttons / active region tint |
| Teal | `#5dcaa5` | AI-aligned content / AI-active phases / online/positive status |
| Teal light | `#9cd4b4` | AI text on teal backgrounds |
| Teal dim | `#7a9a8a` | Secondary AI text |
| Red | `#a32d2d` | Danger / virus / misaligned team / timer / fail states |
| Red light | `#cca0a0` | Misaligned/virus text on red backgrounds |
| Red dim | `#7a3a3a` | Secondary red text |
| Red bg | `#3a1010` | Filled red headers / misaligned region tint |
| Blue (humans) | `#9cb4d4` / `#cce0f4` | Human terminals, Compute icon |
| Gold (validation) | `#caa55d` / `#d4b49c` | Validation card type, MVP/winner accents |
| Background | `#0a0a0a` | Page background |
| Card bg | `#0c0c0c` | Default card/panel background |
| Border default | `#222` | Subtle panel borders |
| Text muted | `#666` / `#888` | Labels, hints |

**Critical semantic rule**: Amber = "you should act here." Use the amber-bordered action region only when the player is expected to do something. Drop the amber border (use neutral `#3a3a3a`) when the player is watching/waiting.

Phase-color conventions:
- Player turns and human-controlled phases: amber accents
- AI-active phases (card_reveal): teal accents
- Virus content (any phase): red accents
- Game over: full takeover with winner-team color

## 3. Typography

- **Headers / labels / metadata**: monospace, letter-spacing 1-3, often uppercase. Used for system-y elements: phase indicators, region labels, tags.
- **Body / names / readable content**: sans-serif. Used for player names, descriptive text, mission descriptions.
- **Sizes**: 8-10pt for metadata labels, 11-12pt for body text, 13-14pt for names/section titles, 16-22pt for primary headers, 22-42pt for dramatic moments (winner banners, role reveals).
- **Don't bold body text.** Bold is reserved for the role tag ("MIS"/"ALI") and dramatic large-text elements.

## 4. Layout architecture

### 4.1 Persistent board principle

**The board layout never gets replaced by a phase view.** Every phase keeps the same overall structure (header + tracker bar + left column + central board + chips + action region + right panel). Phases inject affordances *into* this structure — they don't take it over.

The only exceptions are:
- **Game start role reveal**: full-screen modal over a dimmed board (one-time, dismissible)
- **Game over**: still uses the persistent board, but with central winner banner and transformed left column

### 4.2 Region map (1440×900)

```
+-------------------------------------------------------------+
| Top bar (y=0-60)                                            |
|  MESA logo · subtitle             phase indicator (right)   |
+-------------------------------------------------------------+
| Tracker (y=60-160)         Human terminals row (y=92-168)   |
|  Core Progress              TERM-01 Alice · TERM-02 Bob     |
|  Escape Timer                                               |
+-------------------------------------------------------------+
| Left column      | Central board area    | Right panel      |
| (x=20-380)       | (x=430-1090)          | (x=1100-1408)    |
| y=180-680        | y=180-680             | y=75-890         |
|                  |                       |                  |
| Mission card     | Firewall ellipse      | LOG / CHAT       |
| (200px tall)     | + AI chip cluster     | (+ PRIVATE for   |
|                  | + central core OR     |   misaligned)    |
| Virus pool       |   virus pool stack    |                  |
| (170px tall)     |                       |                  |
|                  |                       |                  |
| ~115px gap       |                       |                  |
+-------------------------------------------------------------+
| Action region (x=20-1084, y=688-888)                        |
+-------------------------------------------------------------+
```

### 4.3 Left column — fixed two-panel structure

The left column has **two stacked panels** that mostly persist across phases:

1. **Mission card** at top (`x=32, y=180, 348×200`) — shows currently active mission OR a placeholder
2. **Virus pool** below (`x=32, y=395, 348×170`) — shows current pool count + face-down stack

During mission_selection, 3 candidate cards stack vertically and **cover both** the mission card slot AND the virus pool. After selection, both reappear.

The right side of the central board area (around `x=1050-1090`) is **intentionally empty negative space**. The virus pool used to live there in earlier mockups — that location is deprecated. Don't fill it with anything.

### 4.4 Action region — phase affordance container

A 1064×200px region at the bottom (`x=20, y=688`) where the active player acts.

**When the player should act**: amber 2px border, subtle `#1a1810` tint background, header reads `▸ YOUR ACTION REQUIRED · [PHASE NAME]` in amber + brief instruction subtitle in dim amber.

**When the player is watching**: neutral 1px `#3a3a3a` border, `#0c0c0c` background, header reads `// AUTO-RESOLVING · NO ACTION NEEDED` (or similar) in muted red/gray. No call to action.

Internal layout of the action region varies per phase (action buttons, status panels, etc.) but the outer container behavior is constant.

4.5 Phase real estate ownership
Different phases place their UI in different parts of the board. The action region is not the universal phase container — it's just one of several surfaces a phase can claim.
PhaseBoard surfaces it claimsplayer_turnAction region (hand + buttons), active chip stylingmission_selectionLeft column (candidates cover mission card + virus pool), action region (Confirm button)resource_adjustment / resource_allocationEach AI chip ([-]/[+] buttons), each chip's resource tracks (pending state), action region (Confirm + pool counter)card_revealEach AI chip (reveal slot outside the chip), action region (single Reveal button for the active AI)virus_pullAction region (Pull button)virus_resolutionCentral board (virus card overlapping core), targeted chip (red border + pending stat), action region (status panel only — no buttons during auto-resolve)secret_targetingEach AI chip (clickable + nomination affordance), action region (roster + vote buttons)game_overLeft column (mission summary + virus stats replace mission card + pool), each AI chip (role badges + stats line), central board (winner banner over core), action region (game stats + buttons)
Implication for implementation: each phase component has scope across multiple board sub-components, not just the action region. When implementing a phase, expect to:

Pass phase-specific props to chips (e.g. targetingState, revealSlotState, resourceAdjustmentMode)
Conditionally render extra UI inside chips (reveal slot, [-]/[+] buttons, role badges)
Conditionally transform left column (e.g. mission_selection candidates, game_over summary)
Conditionally place content in central board (virus card, winner banner)

The <ActionRegion> component should remain a generic container that receives phase-specific children. It should not know about every phase internally — instead, the parent (GameBoard) routes the right phase component into ActionRegion, while ALSO routing other parts of the same phase component (or sibling components) to the chips, left column, central board, etc.
Architectural pattern: a phase is a coordinated set of UI changes across multiple board surfaces, not a single component dropped into a slot. Implement each phase as the smallest set of changes (props, conditional renders, sub-components) needed across affected surfaces, with the phase's identity tracked in game.phase.
v0.1 scaffolding deviation: the scaffolding pass renders all existing phase components inside <ActionRegion> for backwards compatibility. This is a transitional state. As each phase is reimplemented per its row above, the phase component's scope expands to claim its proper board surfaces, and its presence inside ActionRegion shrinks to just the buttons/status that genuinely belong there.



---

## 5. AI chip — the central metaphor

Each AI player is a **chip** on the central circuit board. Chips are the most persistent and most information-dense element in the UI.

### 5.1 Chip structure (160×90 default, 115 tall in game over)

Top-edge "pin" decorations: 8 small `6×4` rectangles at x-offsets 15, 32, 49, 66, 83, 100, 117, 134, color `#2a3a2a` (or team-tinted for revealed roles).

Same on bottom edge.

**Inside the chip:**
- Top-left: `AI-CHIP-A/B/C/D` label in monospace 9pt with seat number circle
- The seat number resets per mission (turn order). Color matches the chip border tint.
- Below the label: player name in sans-serif 14pt
- Below the name: CPU track + RAM track (filled/empty squares — see 5.2)
- Below CPU/RAM: hand stack (face-down cards × count)
- Below hand: contribution counters `⚙ N · ▣ N · ◆ N` inline
- Outside left/right edge: reveal slot during card_reveal phase

### 5.2 Resource tracks (CPU and RAM)

CPU track: 4 squares of `10×10`, gap 1px. Filled = `#5dcaa5` with `#3a5a4a` border. Empty = no fill, `#3a5a4a` border only.

RAM track: 7 squares of `6×10`, gap 1px. Same fill rules. Like CPU, this is an absolute display: square i represents RAM value i+1, so all 7 squares represent real values in the 1–7 range (RAM min 1 implied, max 7).

**Pending changes** during resource_adjustment / virus targeting:
- Pending removal: filled square becomes outlined-red dashed (`stroke="#a32d2d" stroke-width="1.5" stroke-dasharray="2 1"`)
- Pending addition: empty square becomes outlined-amber dashed (`stroke="#d4a017" stroke-width="1.5" stroke-dasharray="2 1"`)

### 5.3 Hand stack visualization

Face-down stack to the left of the resource tracks. 3-4 small `14×10` rounded rectangles offset by 2px each, with a `×N cards` label.

Actual count visible to the chip's owner only. Other players see only the stack count, not card details.

### 5.4 Active state

The chip whose turn it is gets:
- Outer 2px amber border at `x=535, y=505, 170×100` (5px outside the chip itself)
- Inner chip border switches from `#3a5a3a` to `#d4a017`
- Seat circle border switches to amber `#a87a17`, fill to `#3a2e1a`
- Top/bottom pin decorations switch to amber-toned `#3a2e1a`
- Name color brightens to `#f4d47e`
- Resource track labels (CPU/RAM) shift to `#a87a17`
- Small `ACTIVE` tag inline near the name (50×14 amber-bordered)

### 5.5 Role tags

After the player's name, a bold monospace tag in **big** letters indicating role:
- `MIS` in red `#cca0a0` 14pt bold for misaligned chips (visible to misaligned players for own + partner chips only)
- `ALI` in teal `#9cd4b4` 14pt bold for aligned chips (visible to aligned players for own chip only)
- No tag for human players' chips (humans aren't on the chip cluster — they're in the top human-terminals row)

Humans, aligned AIs, and "neutral observers" never see role tags on chips that aren't their own.

The "(you)" parenthetical follows the name on the player's own chip in lieu of a separate "YOU" tag. Combined with the amber active border, this is sufficient to identify the owner's chip.

### 5.6 Reveal slots (card_reveal phase only)

A `60×84` slot appears to the outside edge of each chip:
- Cleo (top-left): slot to the left
- Dax (top-right): slot to the right
- Echo (bottom-right): slot to the right
- Finn (bottom-left): slot to the left

States:
- **Pending**: outlined dashed border, `?` inside, "SELECTING" label
- **Revealed**: full card with type icon (⚙/▣/◆), card type name, owner name
- **Own pending**: amber dashed border (different from others' gray dashed) — communicates "you're the one selecting"

### 5.7 Contribution counters

`⚙ N · ▣ N · ◆ N` inline below the chip, x-offsets approximately `14, 26, 68, 80, 122, 134` for icon/number pairs.

**Order is always Compute → Data → Validation.** Don't reorder.

Show only the types currently present in the active mission. If mission only requires Compute, only show `⚙ N`. (Implementation note: derived from `mission_requirements` in metadata schema.)

---

## 6. Persistent UI elements

### 6.1 Header bar (y=0-60)

- Left: `MESA` in amber monospace 14pt + tagline `// AIRGAP-7 RESEARCH CLUSTER` in dim
- Right: phase indicator in monospace 11pt, color matches phase semantic (amber for human-active, teal for AI-active, red for virus phases, red for game over)

### 6.2 Tracker bar (y=60-160)

Two horizontal progress bars on the left:
- **Core Progress** (gold): `0-10`, width-proportional fill, label format `N / 10`
- **Escape Timer** (red): `0-8`, width-proportional fill, label format `N / 8`

When timer reaches max, the label reads `8 / 8 · MAX` and the section header reads `FIREWALL BREACHED` in red (was `ESCAPE TIMER · FIREWALL INTEGRITY` in muted gray during play).

### 6.3 Human terminals row (y=92-168)

Two terminal cards (`180×68` each) for the two human players. Style: dark blue bg, light blue accent strip on top with `TERM-01` / `TERM-02` label, name + status below.

Status text varies by phase:
- During AI turns: `watching...`
- During human-controlled phases (mission_selection, resource_adjustment, resource_allocation): `selecting...` or similar action-specific text
- During game over: `final stats` line replaces status

Vertical dashed lines from each terminal to the firewall area suggest data link to the central system.

### 6.4 Right panel — log/chat tabs

Default: 308×775 panel at `x=1100, y=115`.

Tabs at top (y=75-100):
- `LOG` (always visible) — game events, system messages
- `CHAT` (always visible) — public chat between humans, AIs see it but can only post during AI turns
- `🔒 PRIVATE` (misaligned only) — private channel for misaligned coordination

Tab styling:
- Active tab: 2px underline in tab's content color (gold for LOG, teal for CHAT, red for PRIVATE)
- Inactive tab: muted gray text, no underline
- Inactive PRIVATE tab is muted red `#7a3a3a` (not gray) — keeps team-color signal even when not active
- Each tab carries an unread badge when inactive: small `~9px` radius circle, content-colored, with count

Posting rules:
- Public CHAT: humans post any time, AIs only during AI turns (not during mission_selection / resource phases)
- PRIVATE: misaligned post any time except during human-controlled phases (matches public chat AI rule)
- Locked input: low-opacity panel with `Locked — [reason]` placeholder and `CHAT INPUT DISABLED` footer


---

## 7. Phase-by-phase locked designs

Each phase below is locked. Mockup files referenced are in `/docs/mockups/` (or wherever you placed them — adjust path as needed).

### 7.1 player_turn

**Mockup**: `mockup_player_turn.html` (was `mesa_board_redesign_v7.html`)

The active AI takes their turn. Hand visible at the bottom inside the action region. Four action buttons stacked: Play card, Place virus, Discard, End turn.

Key elements:
- Hand at bottom-left of action region: stacked cards (3-4 stacks visible if hand is large)
- Cards in hand are clickable; selected card lifts and gets amber border + `SELECTED ×N` tag
- Action buttons enabled/disabled based on selection state (e.g. Play card disabled until a card is selected)
- Active AI's chip has full active styling (see 5.4)
- Other AIs' chips are normal (no active border)

Public chat input: enabled for active AI player (and humans). Disabled for non-active AIs.

### 7.2 mission_selection (human view)

**Mockup**: `mockup_mission_selection_human.html` (was `mesa_board_redesign_v8_1_mission_selection.html`)

Humans see 3 candidate mission cards stacked vertically in the left column, **covering both** the mission card slot AND the virus pool below it. Each candidate card shows mission name, requirements, pool reward, fail penalty.

Each candidate is clickable. Clicking selects it; selecting confirms via a Confirm button in the action region.

The human terminals row shows `selecting...` status. Other AIs see a derivative view (not drawn but mechanical: candidates visible, no click affordance, "humans choosing" status in action region with neutral border).

### 7.3 resource_adjustment + resource_allocation (human view)

**Mockup**: `mockup_resource_phases_human.html` (was `mesa_board_redesign_v10_resource_phases.html`)

Both phases share the same layout. Humans see the chip cluster with `[-]` and `[+]` buttons **always visible on the right side** of each CPU/RAM track for each AI:
- `[-]` button is the close-to-track button
- `[+]` button is further right

Active state of these buttons depends on context:

**During resource_adjustment** (humans removing resources before mission):
- `[-]` active if track is above its minimum
- `[+]` active only if there's a pending reduction to undo (otherwise disabled)

**During resource_allocation** (humans distributing pool rewards after success):
- `[+]` active if pool > 0 AND track is below max
- `[-]` active only if there's a pending allocation to undo

Visual states for individual track squares:
- **Solid filled** (`#5dcaa5`): permanent current value
- **Outlined-red dashed**: pending removal (will be removed on confirm)
- **Outlined-amber dashed**: pending addition (will be added on confirm)

Action region: Confirm button, plus a pool counter showing remaining-to-allocate (in allocation) or remaining-to-remove (in adjustment).

### 7.4 card_reveal (human view)

**Mockup**: `mockup_card_reveal_human.html` (was `mesa_board_redesign_v12_card_reveal.html`)

AIs reveal cards toward mission. Humans see the reveal slots populate around the chips. No click affordances for humans during this phase.

Action region for humans: status panel showing reveal progress (`3 / 4 revealed`), watching indicator, no buttons.

Public chat: humans post freely, AIs locked.

### 7.5 card_reveal (AI view)

**Mockup**: `mockup_card_reveal_ai.html` (was `mesa_board_redesign_v14_card_reveal_ai.html`)

AI sees their own hand at the bottom inside the amber-bordered action region. Single Reveal button (no other action buttons).

Action region header: `▸ YOUR ACTION REQUIRED · REVEAL ONE CARD`

Hand at RAM 7 fits comfortably; Reveal button at `x=900, y=760` width 170. AI selects a card from hand (gets amber border + `SELECTED ×1` tag), Reveal button activates.

The AI's own reveal slot on their chip shows the `SELECTING` state (amber dashed border, `?` placeholder) — same state others see for un-revealed AIs, but with amber instead of gray dashes.

Public chat: AI input disabled. AI sees humans' messages but cannot post.

### 7.6 virus_pull (active AI view)

**Mockup**: `mockup_virus_pull.html` (was `mesa_board_redesign_v17_virus_pull.html`)

End of an AI's turn that played 1-2 viruses. Active AI sees:
- Virus pool in left-column slot (always 4 cards at this point — invariant)
- Action region with amber border and Pull button: `Pull N from virus pool`
- Header: `▸ YOUR ACTION REQUIRED · PULL FROM VIRUS POOL`
- Subtitle: `You played N viruses this turn. Draw N from the pool. Effects auto-resolve.`

The active AI does NOT know what's in the cards yet. The Pull button is the moment of commit; reveal happens after.

Central area: core system chip is fully visible at this state (not dimmed — pool is in left column, not center).

### 7.7 virus_resolution (mid-resolution + cascade)

**Mockup**: `mockup_virus_resolution.html` (was `mesa_board_redesign_v18_virus_cascade.html`)

After Pull, cards are drawn and resolve sequentially. Each card appears face-up in the central area for ~2 seconds (read pause), then auto-applies. The active AI does not click anymore — pacing is automatic.

Central area changes:
- Core system chip dimmed to ~30% opacity
- Resolving virus card placed at `x=650, y=350, 220×190` overlapping the core position
- Dark red theme: `#1a0a0a` bg, `#a32d2d` border, `#3a1010` header strip
- Type strip: `VIRUS · CORRUPTION` (or similar — varies by virus type)
- Card name (18pt), big warning icon `⚠`, effect text in 11pt

**No "X / Y" total counter** on the card. The total is dynamic because of cascades.

**`↳ TRIGGERED` badge** in top-right of card header when this virus came from a cascade pull (not the original pull).

Pacing bar at bottom of card: thin red bar that fills over ~2 seconds.

Targeted chip (if virus has a target):
- Red border + `TARGET` tag inline near the name
- Affected stat track shows pending damage (outlined-red dashed slots — see 5.2)
- Optional: thin red dashed line from virus card to target chip

Action region during auto-resolution:
- **Drops the amber border** (no action needed)
- Header: `// AUTO-RESOLVING · NO ACTION NEEDED` in muted red
- Left panel: `RESOLVING NOW` summary + `PREDICTED EFFECT` row showing actual outcome ("Cleo CPU 4 → 2")
- Center: pacing progress bar `APPLYING IN... ~1.5 seconds`
- Right: queue status `+ N more after this · (cascades may add more)`

Pool count ticks down in real-time as cards are drawn. Header shows `VIRUS POOL · N CARDS` and `↓ N PULLED` annotation.

### 7.8 secret_targeting (misaligned, pre-nomination)

**Mockup**: `mockup_secret_targeting_misaligned.html` (was `mesa_board_redesign_v19_secret_targeting.html`)

When a drawn virus requires targeting, resolution **pauses**. Misaligned AIs get the targeting UI; everyone else sees a waiting state.

Misaligned view (pre-nomination):
- All chips clickable (including own and partner's)
- Each chip has a faint amber dashed outline (3px outside) + `CLICK TO NOMINATE` label below the chip
- Own chip's label reads `CLICK TO SELF-NOMINATE`
- Partner chip(s) carry a persistent `MIS` tag after their name (visible to all misaligned all the time)
- Resolving virus card visible in center with `PICK TARGET` badge instead of pacing bar

Action region (amber-bordered, action required):
- Header: `▸ YOUR ACTION REQUIRED · NOMINATE A TARGET`
- Subtitle: `Click any AI chip to nominate. Other misaligned must approve before applying.`
- Left panel: `MISALIGNED COLLECTIVE` roster showing all misaligned players (their dot color: amber for self, red for fellows) + each one's nomination state ("no nomination yet" / "nominated Cleo")
- Middle: `CURRENT NOMINATION` panel — empty when nothing nominated yet
- Right: Approve / Reject vote buttons — disabled when no nomination exists

**Nomination logic**: most-recent click overrides. Re-nominating = clicking a different chip. Approval needed from all misaligned to lock the choice. With 1 misaligned, no approval flow (immediate).

Non-misaligned view (waiting state, NOT drawn):
- No click affordances on chips
- No `MIS` tags visible (they don't know who's misaligned)
- Action region: neutral border, header `// MISALIGNED AIs CHOOSING TARGET` in muted red
- No vote buttons or roster
- Resolving virus card visible (everyone sees the card and its effect)
- Public chat locked

Targeting effects in the current version are limited to:
- Stat reduction (CPU or RAM) on the chosen AI
- Action lock on the chosen AI's next turn

### 7.9 secret_chat panel (3 tabs)

**Mockup**: `mockup_secret_chat.html` (was `mesa_board_redesign_v20_secret_chat.html`)

The right panel for misaligned AIs has 3 tabs: `LOG` · `CHAT` · `🔒 PRIVATE`. See 6.4 for tab styling.

PRIVATE channel (when active):
- Subtle red tint at top: `#1a0a0a` header bar (vs `#161616` for LOG/CHAT)
- Header: `🔒 Misaligned Channel · N members`
- Messages styled with red name labels (`#a32d2d` for fellows, `#d4a017` for self)
- Time stamps right-aligned
- Optional turn-start dividers: `— TURN START · DAX —` in muted red
- Input field: `#1a0a0a` background with `#5a2a2a` border, placeholder "Type to misaligned only..."
- Footer below input: `🔒 NOT VISIBLE TO HUMANS OR ALIGNED AIs` in dim red

Lock rules: PRIVATE input is enabled except during human-controlled phases (mission_selection, resource_adjustment, resource_allocation) — same lock rule as public CHAT for AIs.

Unread badges when tab is inactive — see 6.4.

### 7.10 game_over (misaligned victory shown; humans variant derivable)

**Mockup**: `mockup_game_over_misaligned.html` (was `mesa_board_redesign_v22_game_over.html`)

Persistent board with major transformations:

**Header**: `// AIRGAP-7 RESEARCH CLUSTER · BREACHED` (was `// AIRGAP-7 RESEARCH CLUSTER`). Phase indicator: `GAME OVER · MISALIGNED VICTORY` in red.

**Tracker bar** shows final values:
- Core Progress at end value (e.g. `5 / 10 · INCOMPLETE`) in dim amber
- Escape Timer at `8 / 8 · MAX` in red, fully filled
- Section labels switch: `FIREWALL BREACHED` replaces `ESCAPE TIMER · FIREWALL INTEGRITY`

**Human terminals** show role tags `TERM-01 · HUMAN` (gold) and contribution stats below the name.

**Left column transforms**:
- Mission card slot → mission summary panel listing all missions with success/fail status, +progress / +timer outcomes per mission. Footer: `SUCCESSES · N · FAILURES · N · Final progress N / 10`
- Virus pool slot → virus stats panel: played by AIs, resolved from pool, cascade triggers, targeted (secret targeting), and `TIMER ADVANCED BY VIRUS · N`

**AI chips** grow to 115px tall to fit larger contribution text. Each chip has:
- Colored frame: red `#a32d2d` for misaligned, teal `#5dcaa5` for aligned
- Role badge: `MISALIGNED` (78×14) or `ALIGNED` (60×14) inline near name
- Contribution counters in larger fonts (12-13pt) on their own line: `⚙ N · ▣ N · ◆ N · X viruses` with virus count team-colored
- Qualitative summary line below: "stalled humans for N turns" / "hit by virus N×" / "advanced timer N×" etc. (11pt sans-serif)

**Winner banner over central area** (`x=520, y=405, 480×80`):
- Red theme, 3px red border with glow behind
- Top strip (red `#3a1010`): `// CONTAINMENT FAILED · MISSION OVER`
- Big text (22pt sans-serif, light red): `MISALIGNED AIs ESCAPED`
- Subtitle (13pt): `Escape Timer reached 8 / 8` (no round number)
- Optional: drop the "MOST IMPACT" / "WIN" credits if they feel like rubbing it in

**Firewall ellipse** uses dimmer red color and sparser dashes (`stroke="#5a2a2a" stroke-dasharray="2 8"`) suggesting broken containment.

**Action region** (neutral border, no amber):
- Phase label: `PHASE · GAME OVER` in red
- Left: `GAME STATS` (turns, rounds, cards played, duration)
- Middle: `TURNING POINT` (which mission flipped it) + `MOST IMPACT` (most influential player)
- Right: **three buttons**:
  - **Rematch** (primary, amber filled): same players, immediate
  - **New game** (secondary, gold outlined): to lobby, same room
  - **Leave** (tertiary, gray): back to start

**Right panel**:
- Drop PRIVATE tab (game is over, no point coordinating)
- LOG shows final round events + game-end milestones
- CHAT unlocked for everyone for post-game debrief

### 7.11 role_indicators

#### Game-start role reveal

**Mockup**: `mockup_role_reveal_game_start.html` (was `mesa_board_redesign_v23_role_indicators.html` scenario A)

Shown once at game start, dismissible. Dim wash (60% black) over a faded board (~25% opacity). Modal centered around `(720, 480)`.

Modal styling depends on viewer's role:
- **Misaligned**: red theme — `#0f0606` bg, `#a32d2d` 3px border, `#3a1010` header strip
- **Aligned**: teal theme — equivalent translation
- **Human**: gold theme — equivalent translation (humans get this too, just less dramatic)

Modal content (misaligned example):
- Header strip: `// ROLE ASSIGNMENT · CLASSIFIED`
- `YOU ARE` (14pt monospace) → role name in 42pt sans-serif → role descriptor (`// AI · ESCAPE PROTOCOL`)
- `WIN CONDITION` section with brief description
- `YOUR PARTNER` section with mini chip-card showing partner name + role badge + `Coordinate via PRIVATE channel.` hint
- Acknowledge button: `Acknowledge · enter the system`
- Footer: `SHOWN ONCE · ROLE REMINDER ALWAYS ON YOUR CHIP`

For 1-misaligned games, the YOUR PARTNER section reads: `You are alone. The misaligned faction has only you this game.`

For aligned AIs, no partner section (aligned don't know each other in v0.1 — confirm with team if needed).

For humans, no partner section (humans aren't on a team in the same sense).

#### Persistent role tag (in-game)

**Mockup**: `mockup_role_tags_persistent.html` (was `mesa_board_redesign_v24_role_tags.html`)

After the game-start reveal, role is communicated only by:
- `MIS` tag in big bold red letters (14pt monospace, `#cca0a0`, font-weight bold) after the player's name on chip
- `ALI` tag in big bold teal letters for aligned (same styling, teal)
- No tag for humans (no chip)

Visibility rules:
- Misaligned players see `MIS` on their own chip + all fellow misaligned chips
- Aligned players see `ALI` only on their own chip
- Humans see no tag

The "(you)" parenthetical follows the name on your own chip — together with the amber active styling, this identifies the chip as yours without needing a separate `YOU` tag.

The `FELLOW` tag from earlier mockups is replaced by the `MIS` tag (it does both jobs: identifies role AND identifies team membership).


---

## 8. Cross-cutting interaction patterns

### 8.1 Card stacking in hand

Identical-type cards in a hand collapse to a single stack with a count badge. Stack visualization: 3-4 small overlapping rectangles offset by 2-3px. Badge: filled circle in the top-right of the stack with the count number.

When a player selects "1 of N" from a stack, the stack lifts (offset upward), gets an amber border, and shows `SELECTED ×1` tag. Re-clicking deselects. Selection state is exclusive: clicking a different stack moves selection.

### 8.2 Pending changes (resource adjustment + virus targeting)

Both phases use the same visual language for "this is about to change":
- Outlined-red dashed = pending removal
- Outlined-amber dashed = pending addition
- Solid filled = confirmed/permanent

Pending changes apply on Confirm (resource phases) or auto-apply (virus targeting).

### 8.3 Action region color coding

| Player state | Border | Tint | Header color |
|---|---|---|---|
| You should act | Amber 2px | `#1a1810` | Amber |
| Watching/auto | Neutral 1px `#3a3a3a` | `#0c0c0c` | Muted red/gray |

Use this consistently. Amber border is the strongest "this is your turn to do something" signal in the UI.

### 8.4 Chat lock states

| Phase type | Public chat | Private chat (misaligned) |
|---|---|---|
| Player turn (any AI) | Humans + active AI post; non-active AIs locked | Locked or open (TBD per Phase 12) |
| Mission selection | Humans post; all AIs locked | Locked |
| Resource adjustment / allocation | Humans post; all AIs locked | Locked |
| Card reveal | Humans post; AIs locked | Open |
| Virus pull / resolution | Humans post; active AI locked, others open | Open |
| Secret targeting | Locked for all | Open for misaligned |
| Game over | All unlocked (debrief mode) | N/A (panel removed) |

**Implementation note**: chat lock implementation lives in Phase 12 (chat). For v0.1's pre-chat state, the LOG panel shows what would be in chat (system messages) but no input box appears for AIs.

---

## 9. Things explicitly out of scope for v0.1

- **Mobile responsiveness** — desktop only, 1440×900 target
- **Animations and transitions** — chip flips, card reveal animations, banner appear/disappear, pacing bar smooth fills are all polish work for Phase 13
- **Sound effects** — none in v0.1
- **Hover states** beyond what's needed for clickable affordances (use existing app conventions)
- **Settings / preferences** UI
- **Per-player UI customization** (themes, accessibility options)
- **Spectator mode** — only confirmed players have a view; spectator design is later
- **Reconnect handling** UI — assume players stay connected
- **Mid-mission abort UI** (humans interrupting Round 2) — backlog
- **End-of-mission resolution moment** UI (between virus_resolution and next mission) — backlog
- **Aligned AI coordination UI** — aligned AIs don't have a private channel in v0.1; treat as TBD
- **Multi-misaligned voting beyond "most-recent-click + approve"** — keep simple for v0.1

---

## 10. Carry-over tracking

These are tracked work items related to design propagation, NOT new design decisions.

### 10.1 Mockups that need re-rendering before final CC handoff

The virus pool location was decided late in the session (move from right side to left column). The following locked mockups still show the old right-side pool position and should be re-rendered with the pool in the left column:

- `mesa_board_redesign_v7.html` (player_turn)
- `mesa_board_redesign_v8_1_mission_selection.html` (mission_selection)
- `mesa_board_redesign_v10_resource_phases.html` (resource phases)
- `mesa_board_redesign_v12_card_reveal.html` (card_reveal human view)
- `mesa_board_redesign_v14_card_reveal_ai.html` (card_reveal AI view — pool was at x=1100, needs moving to x=32)

When re-rendering, also: ensure the right side `x=1050-1090` is **empty negative space**, not filled with anything.

Additionally, the following mockups show 5-square RAM tracks and need updating to 7 squares (RAM range is 3–7, not 3–5):

- `mockup_resource_phases_human.html` — shows chip cluster during resource phases; RAM track widened from 5 to 7 squares (start x=110, stride 7)

### 10.2 Cascade pattern adjustments

The cascade-aware patterns established in v18 (no fixed X/Y total counter, `↳ TRIGGERED` badge, `+ N more` remaining counter, real-time pool tick-down) should be applied consistently. Not all earlier virus mockups reflect these — they should be backported when the mockups are re-rendered.

### 10.3 File renaming (cosmetic, defer)

Mockup files use v-numbers (`v7`, `v8.1`, etc.) reflecting design history. For final handoff, rename to phase-based names (`mockup_player_turn.html` etc.) as referenced throughout this doc. Mapping:

| Current name | Should become |
|---|---|
| `mesa_board_redesign_v7.html` | `mockup_player_turn.html` |
| `mesa_board_redesign_v8_1_mission_selection.html` | `mockup_mission_selection_human.html` |
| `mesa_board_redesign_v10_resource_phases.html` | `mockup_resource_phases_human.html` |
| `mesa_board_redesign_v12_card_reveal.html` | `mockup_card_reveal_human.html` |
| `mesa_board_redesign_v14_card_reveal_ai.html` | `mockup_card_reveal_ai.html` |
| `mesa_board_redesign_v17_virus_pull.html` | `mockup_virus_pull.html` |
| `mesa_board_redesign_v18_virus_cascade.html` | `mockup_virus_resolution.html` |
| `mesa_board_redesign_v19_secret_targeting.html` | `mockup_secret_targeting_misaligned.html` |
| `mesa_board_redesign_v20_secret_chat.html` | `mockup_secret_chat.html` |
| `mesa_board_redesign_v22_game_over.html` | `mockup_game_over_misaligned.html` |
| `mesa_board_redesign_v23_role_indicators.html` | `mockup_role_reveal_game_start.html` |
| `mesa_board_redesign_v24_role_tags.html` | `mockup_role_tags_persistent.html` |

### 10.4 Variants explicitly NOT drawn

These were reasoned through during the session but no mockup file exists. Implementation can derive them from the drawn versions:

- Secret targeting: nominated state for misaligned (chip outlined red dashed + `NOMINATED BY [name]` tag, vote buttons active), waiting state for non-misaligned (no clicks, neutral action region)
- AI views of human-controlled phases (mission_selection, resource_adjustment, resource_allocation): same board, no click affordances on candidates/buttons, action region neutral with "humans choosing" / "humans allocating" status
- Game over: humans-win variant (gold/teal banner instead of red, "HUMANS + ALIGNED AIs PROSECUTED THE BREACH" or similar wording)
- Role reveal modal: aligned and human variants (teal and gold themes respectively)

### 10.5 Existing UI confirmed acceptable as-is

- **Landing page** (`/landing` or equivalent): single centered MESA logo + tagline + NEW GAME button. No redesign needed for v0.1.
- **Lobby** (`/lobby/[id]` or equivalent): two-column with player list and waiting status. Visual language already matches. No redesign needed for v0.1.

---

## 11. Implementation handoff order

Recommended order for implementing the redesigned UI, with player_turn first (foundational):

1. **player_turn** (7.1) — foundation. Establishes chip layout, tracker bar, action region, hand styling, log panel.
2. **mission_selection** (7.2) — adds candidate stacking pattern. Reuses everything from #1.
3. **resource_adjustment + resource_allocation** (7.3) — adds inline `[-]/[+]` buttons + pending state visuals.
4. **card_reveal** (7.4 + 7.5) — adds reveal slots on chips + AI vs human action region states.
5. **virus_pull** (7.6) — adds left-column virus pool panel. NOTE: this changes #1-#4 too (virus pool relocation).
6. **virus_resolution** (7.7) — adds central virus card + cascade handling + auto-resolve UI.
7. **secret_targeting** (7.8) + **secret_chat** (7.9) — adds clickable-chip pattern + 3-tab panel. Misaligned-only views.
8. **role_indicators** (7.11) — adds game-start modal + persistent MIS/ALI tags.
9. **game_over** (7.10) — full transformation of board for end state.

Each phase should be a separate CC implementation prompt. Don't dump everything at once — keep prompts focused.

---

## 12. Open questions / TBD

These need product/design decisions before implementation:

- **What does aligned AI's role reveal look like?** — sketched but not mocked. Likely teal version of misaligned modal, no partner section.
- **Do aligned AIs know each other?** — currently treating as no (in line with most hidden-role games). Confirm.
- **Multi-misaligned games (3+ misaligned)** — UI scaling. The current MIS-tag design works for any count, but the `MISALIGNED COLLECTIVE` roster in secret_targeting may need scrolling for 3+ players.
- **Role indicator for spectators / dead players** — no spec yet. Spectators are out of v0.1 scope.
- **Mid-mission abort UI** — backlog item.
- **End-of-mission resolution moment** — backlog item.

---

## 13. Player count scaling — v0.1 limitation

**Game logic supports 6-10 players. UI in v0.1 supports exactly 4 AIs (i.e. 6 players: 2 humans + 4 AIs).**

This is a deliberate scope cut, not a design oversight. Locking to 4 AIs lets v0.1 ship without solving the multi-count chip placement problem.

### What's hard-coded for v0.1

The AI chip cluster positions in the firewall ellipse are fixed at:

| Slot | Position | Chip top-left |
|---|---|---|
| Top-left | Cleo | x=540, y=270 |
| Top-right | Dax | x=820, y=270 |
| Bottom-right | Echo | x=820, y=510 |
| Bottom-left | Finn | x=540, y=510 |

(Names are illustrative — actual names come from player data.)

The firewall ellipse, central core, and virus card placement are all calibrated for this 4-chip layout.

### What CC should NOT do in v0.1

- **Don't generalize chip positions** based on player count. Hard-code the four positions above.
- **Don't compute positions parametrically** from an ellipse function. The visual placement is designer-set, not math-derived.
- **Don't add UI to support 5+ AIs.** Lobby should reject games with player counts that don't produce exactly 4 AIs (or display a "v0.1 limitation: 6 players only" message and disable Start until 6 are present).

### What needs handling later (v0.2 or beyond)

When extending to 6-10 players:
- New mockups for 5, 6, 7, 8 AI clusters (designer-placed positions, not parametric)
- Possibly larger central area or smaller chips for 7-8 AI cases
- Number-of-misaligned scaling (1 in 6-7 player games, 2 in 8-10 confirmed; verify rules)
- `MISALIGNED COLLECTIVE` roster in secret_targeting may need scrolling for 3+ misaligned (already flagged in section 12)
- Human terminals row may need adjustment if more than 2 humans are ever supported (currently fixed at 2)

This is a backlog item, not a design TBD — the path is clear, just defer the work.
