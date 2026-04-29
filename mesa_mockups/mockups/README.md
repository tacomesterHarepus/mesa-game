# MESA UI mockups

Static HTML mockups for v0.1 board redesign. Each file is a self-contained SVG inside an HTML wrapper. Open in any browser to view.

These are visual targets for implementation, not interactive prototypes. See `UX_DESIGN.md` (in repo root) for design rationale and locked decisions.

## Canonical persistent-layout reference

**`mockup_wall_layout.html`** is the canonical reference for the persistent board layout: top bar, firewall ellipse position, human terminals, Core System node, left/right column regions. Use this file when assessing board structure.

All other mockups pre-date the wall-layout redesign. Their **persistent layout content (top bar, firewall, Core System position) is stale and OBSOLETE**. Their **per-phase action region content (hand, phase-specific UI, action buttons) is still accurate** and is the primary reason to consult them.

Each stale file contains a `STALE — pre-wall-layout (2026-04-29)` comment at the top of `<body>` as a reminder.

## Files

| File | Phase | Viewer | Layout status |
|---|---|---|---|
| **mockup_wall_layout.html** | persistent board | all | ✅ **canonical** |
| mockup_player_turn.html | player_turn | active AI | ⚠ stale persistent layout |
| mockup_mission_selection_human.html | mission_selection | human | ⚠ stale persistent layout |
| mockup_resource_phases_human.html | resource_adjustment + resource_allocation | human | ⚠ stale persistent layout |
| mockup_card_reveal_human.html | card_reveal | human | ⚠ stale persistent layout |
| mockup_card_reveal_ai.html | card_reveal | AI | ⚠ stale persistent layout |
| mockup_virus_pull.html | virus_pull (pre-pull) | active AI | ⚠ stale persistent layout |
| mockup_virus_resolution.html | virus_resolution (mid-cascade) | active AI | ⚠ stale persistent layout |
| mockup_secret_targeting_misaligned.html | secret_targeting (pre-nomination) | misaligned AI | ⚠ stale persistent layout |
| mockup_secret_chat.html | persistent panel pattern | misaligned AI | ⚠ stale persistent layout |
| mockup_game_over_misaligned.html | game_over (misaligned victory) | all roles | ⚠ stale persistent layout |
| mockup_role_reveal_game_start.html | one-time role reveal modal | misaligned AI | ⚠ stale persistent layout |
| mockup_role_tags_persistent.html | persistent in-game role tags | misaligned AI | ⚠ stale persistent layout |
| mockup_player_turn_density_pass.html | player_turn (density pass) | active AI | ⚠ stale persistent layout |

## Notes for implementers

- All mockups target 1440×900 desktop. Mobile is out of scope for v0.1.
- All mockups show the 4-AI / 6-player layout. Higher player counts are out of scope for v0.1 (see UX_DESIGN.md section 13).
- Several mockups still show the virus pool in its old right-side position (see UX_DESIGN.md section 10.1). The locked decision is left-column placement under the mission card. Re-render before final polish.
- Mockups are static SVG. They communicate visual intent, not animation/interaction details. Implementation polish (transitions, hover states, etc.) is Phase 13 work.
