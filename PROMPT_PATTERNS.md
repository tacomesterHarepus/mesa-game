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