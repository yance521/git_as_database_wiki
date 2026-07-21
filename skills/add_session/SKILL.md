---
name: add_session
description: Set the current repository's latest Codex session branch or list sessions on a specified branch. Invoke when user wants to bind or inspect Codex sessions by branch.
---

# Add Session

Use the scripts in `scripts/` so the skill stays self-contained.

## Set Branch

When the user specifies a target branch value, run:

`./scripts/set_branch.sh <branch>`

This updates the latest Codex session for the current repository by setting:

`session_meta.payload.git.branch = <branch>`

## List Sessions On Branch

When the user wants to know which sessions are currently on a branch, run:

`./scripts/list_branch_sessions.sh <branch>`

This lists real Codex sessions for the current repository whose
`session_meta.payload.git.branch` equals the specified branch.
