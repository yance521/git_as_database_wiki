---
name: story-review-doc
description: Generate a review document from commit-linked Story evidence.
---

Run `story review generate --commit <commitish> --json`. The command writes the
review artifact into the checkpoint ref and returns its content. Do not claim
review evidence that is absent from the linked transcript or metadata.
