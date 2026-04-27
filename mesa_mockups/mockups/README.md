# MESA UI mockups

Static HTML mockups for v0.1 board redesign. Each file is a self-contained SVG inside an HTML wrapper. Open in any browser to view.

These are visual targets for implementation, not interactive prototypes. See `UX_DESIGN.md` (in repo root) for design rationale and locked decisions.

## Files

| File | Phase | Viewer |
|---|---|---|
| mockup_player_turn.html | player_turn | active AI |
| mockup_mission_selection_human.html | mission_selection | human |
| mockup_resource_phases_human.html | resource_adjustment + resource_allocation | human |
| mockup_card_reveal_human.html | card_reveal | human |
| mockup_card_reveal_ai.html | card_reveal | AI |
| mockup_virus_pull.html | virus_pull (pre-pull) | active AI |
| mockup_virus_resolution.html | virus_resolution (mid-cascade) | active AI |
| mockup_secret_targeting_misaligned.html | secret_targeting (pre-nomination) | misaligned AI |
| mockup_secret_chat.html | persistent panel pattern | misaligned AI |
| mockup_game_over_misaligned.html | game_over (misaligned victory) | all roles |
| mockup_role_reveal_game_start.html | one-time role reveal modal | misaligned AI |
| mockup_role_tags_persistent.html | persistent in-game role tags | misaligned AI |

## Notes for implementers

- All mockups target 1440×900 desktop. Mobile is out of scope for v0.1.
- All mockups show the 4-AI / 6-player layout. Higher player counts are out of scope for v0.1 (see UX_DESIGN.md section 13).
- Several mockups still show the virus pool in its old right-side position (see UX_DESIGN.md section 10.1). The locked decision is left-column placement under the mission card. Re-render before final polish.
- Mockups are static SVG. They communicate visual intent, not animation/interaction details. Implementation polish (transitions, hover states, etc.) is Phase 13 work.
