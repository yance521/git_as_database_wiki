---
name: using-story
description: Route Story requests to the repository-local Story CLI.
---

Use the installed Story CLI as the only interface to Story evidence.

- “show the conversation behind this commit” -> `story checkpoint show --commit HEAD --json`
- “generate a review” -> `story review generate --commit HEAD --json`
- “handoff this commit” -> `story handoff commit --commit HEAD --json`
- “repair Story” -> `story repair --json`
- “add the current Codex session to a branch” -> `story session add-codex-branch <branch> --json`

Do not read `.story/` or the checkpoint ref directly. Report CLI errors and their
recovery command without fabricating missing evidence.
