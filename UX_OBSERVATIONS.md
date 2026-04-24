# UX Observations

Running log of playtester observations about how MESA *feels* to use, separate from functional bugs. These aren't bugs — they're moments where the game could feel more like a game. Referenced during the future UI/game-feel pass (see PROMPT_PATTERNS.md philosophy on "write state to disk").

## How to use this file

- Add entries as you play, not retrospectively
- Don't fix things from here immediately unless they block testing
- Group observations don't need to be fully articulated — "this felt weird" is fine; we can mine it later
- Distinguish between *aesthetic* observations ("looks flat") and *flow* observations ("I lost track of whose turn it was"). Both matter, but they get addressed differently.

---

## Meta-observation (2026-04-24)

The overall UI presents as a set of static tables rather than a living game. Players essentially read data displays at each phase rather than seeing state transitions happen. This is the biggest standing concern about the current build.

### What's missing that a "game-feel" version would have

- **Spatial presence.** Right now the virus pool, the mission, and the active player are all just labeled boxes. A game would have these occupy *space* — the virus pool looks like a stack of cards, the mission looks like a research station being assembled, the active player's area is clearly "where the action is happening."

- **Transitions that announce themselves.** Phase changes right now are silent swaps of one component for another. Turn handoffs aren't visually telegraphed. In a game-feel version, "Bot 3's turn" would take over the screen momentarily before settling into the normal layout.

- **Visual metaphors.** The cards are buttons with text labels. There's nothing card-like about them — no implied physicality, no suggestion of a hand being held or a deck being drawn from. A game-feel version would lean into the "cards" metaphor instead of presenting them as form controls.

- **Feedback on action.** When an AI plays a card, the card just disappears from their hand and a number updates. A game-feel version would show the card animate toward the mission, the progress bar respond visibly, maybe a sound cue on success.

- **Tension-building moments.** Virus resolution and secret targeting are dramatic in theory but presentationally flat. These are the moments that should *feel* biggest in a social deduction game.

- **Identity reinforcement.** Who am I right now? What's my hand? What's my role? These should be omnipresent, not things I have to hunt for in the UI.

### Why this matters for MESA specifically

MESA is a social deduction game. For this genre, atmosphere isn't optional — it's core to the experience. Games like Blood on the Clocktower, Werewolf, and Secret Hitler all have strong visual identities that make a 6-person group *want* to engage with the table. A mechanically-correct but visually flat social deduction game fails in a specific way: the mechanics work but the group doesn't lean in. That's the risk.

### Current plan status

Phase 13 "UI Polish" is in the current build plan but likely scoped toward cosmetic refinement (colors, typography, spacing, loading states) rather than what's described above. A separate "game-feel pass" may be warranted between phase 12 and phase 13, or in a v2 redesign effort after v1 ships. Decision deferred until more playtesting data is gathered.

---

## Individual observations

Template:

### YYYY-MM-DD — <short description>
**What I noticed:** <plain language>
**What made it feel off:** <why this tripped you up>
**Possible category:** <spatial / flow / feedback / identity / tension / other>
**Severity:** <minor / noticeable / major>

---

### 2026-04-24 — Can't tell whose turn it is
**What I noticed:** Looking at the player roster, nothing visually indicates the active player. Had to check the "Active Player" text in the corner.
**What made it feel off:** In a physical game the active player is obvious from body language. Here the player list is flat.
**Category:** flow, identity
**Severity:** noticeable (being addressed as an immediate fix, not deferred)

### 2026-04-24 — Watching tables
**What I noticed:** General sense that the UI is a set of data displays rather than a game happening.
**What made it feel off:** Nothing moves. Nothing animates. Nothing signals "something important just happened."
**Category:** spatial, feedback, tension
**Severity:** major

### 2026-04-25 — Cards appear instantly instead of being drawn
**What I noticed:** When an AI's turn starts, their hand just updates — cards appear or disappear without any visual transition.
**What made it feel off:** In a physical card game the act of drawing is visible and meaningful. Watching cards snap into existence removes any sense that a hidden deck is being consulted. Draw bugs (wrong count, wrong cards) are also invisible to observers.
**Possible category:** feedback, spatial
**Severity:** medium — acceptable for playtesting, but important for game feel in the final build. Also a practical debugging aid: animated draws make draw-count bugs immediately obvious to observers.

---

### 2026-04-24 — Virus resolution feels like paperwork
**What I noticed:** Viruses resolve via a "Next virus card: X" + "Resolve virus" button screen.
**What made it feel off:** This should be one of the most dramatic moments in the game — the AIs' hidden actions being revealed and potentially sabotaging the mission. Instead it's a form.
**Category:** tension, feedback
**Severity:** major

### 2026-04-24 — Don't know my own alignment
**What I noticed:** As an AI I couldn't find a clear "You are Aligned/Misaligned" indicator.
**What made it feel off:** This is the single most important piece of info for an AI player. It should be impossible to lose track of.
**Category:** identity
**Severity:** noticeable (may be a Phase 13 gap, not yet confirmed)

---

## Themes to watch for as the log grows

As observations accumulate, categorize them and look for clusters. Likely themes based on current data:

- **Identity** — who am I, what do I know, what's my role
- **Flow** — what phase are we in, whose turn is it, what's the action
- **Feedback** — did my action register, what just happened
- **Tension** — do the dramatic moments feel dramatic
- **Spatial** — does the game have physical-feeling presence

The themes with the most observations by the time of the UI pass are the ones to tackle first.

---

## Not captured here

- Functional bugs (those go in DIAGNOSIS_*.md or get fixed inline)
- Known-pending features (Phase 11 game log, Phase 12 chat, etc — gaps in those aren't UX bugs, they're just unfinished)
- Spec questions (e.g. "should mission X allow Y") — those go to the game spec doc, not here
