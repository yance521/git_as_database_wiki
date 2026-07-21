---
name: story-current-commit-session
description: Inspect the coding conversation linked to a commit.
---

Run `story checkpoint show --commit <commitish> --json` (default `HEAD`).
Present the original prompt, linked sessions, files changed, transcript evidence,
key decisions, and review-relevant risks. If no checkpoint exists, state that
the commit has no linked Story evidence.
