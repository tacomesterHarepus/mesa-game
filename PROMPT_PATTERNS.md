# Prompt Patterns

> **For Claude Code: This file is a human-facing reference about how to prompt you.

Patterns developed working with Claude Code on MESA. Keep adding as we find more.

---

## Core philosophy

- **Trust but verify.** CC is very capable but optimistic. Diagnosis-first beats fix-first for anything non-trivial.
- **One fix at a time.** Parallel bug-fixing creates interference and makes rollback impossible.
- **Let humans keep the judgment work.** CC is the actor. You and a reviewer (another Claude chat, in a separate window) keep the judgment calls.
- **Write state to disk.** SESSION_NOTES.md, BACKLOG.md, DIAGNOSIS_*.md — anything you want to survive context compaction or session restart goes in a file, not just chat.

---

## Diagnosis-first (for regressions and complex bugs)

When: bug that's reappeared, bug in unfamiliar code, or previous "fix" didn't stick.

---

## Schema changes need explicit migration instructions

When a plan touches the DB schema (new column, type change, nullability), write the migration SQL and deploy order explicitly in the prompt. Don't leave it implicit.

**Why:** Phase 10.5 added `turn_order: null` for humans in start-game v8, but the migration (011 — make `turn_order` nullable) wasn't listed as a step. The edge function was deployed before the migration was applied. start-game v8 tried to write `null` into a `NOT NULL` column → role assignment failed silently for humans → 7 tests failed with `humanId is null`.

**Deploy order that must be explicit in every schema-touching plan:**
1. Apply migration (SQL Editor or MCP) first
2. Deploy edge functions second
3. Push frontend last

---

## "Pre-existing fragility" requires verification before labeling

Don't write "pre-existing, not caused by \<change\>" in SESSION_NOTES without tracing the failure path through the recent diff.

**Why:** After Phase 10.5, the virus-system `beforeAll` timeout was labeled "pre-existing fragility — not caused by Phase 10.5." It wasn't. Phase 10.5 sorted the DevModeOverlay panel by `turn_order`, which aligned `aiIds[0]` (panel order) with `turn_order_ids[0]` (first player to act). The test gave CPU=2 to `aiIds[0]`, so the first player to act now *always* had CPU=2. The staging-required/disabled-button bug changed from probabilistic (1-in-4 chance) to deterministic (always on the first turn).

**Checklist before labeling a failure "pre-existing":**
1. Was this test passing on the commit before the change?
2. Does the change affect which code path the test exercises?
3. If "50% chance" logic is involved, did the change shift which branch is taken?