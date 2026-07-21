import test from "node:test";
import assert from "node:assert/strict";
import { renderHandoff } from "../../src/core/handoff.ts";

test("handoff contains objective, current state, and next steps", () => {
  const output = renderHandoff({
    checkpoint_id: "cp_demo_0",
    commit_sha: "abc123",
    prompt: "Capture coding memory",
    summary: "feat: capture memory (2 files changed)",
    files_changed: ["src/a.ts", "test/a.ts"],
    transcript: '{"type":"user","text":"Capture coding memory"}\n',
  });

  assert.match(output, /^# Story Handoff: abc123/m);
  assert.match(output, /## Objective/);
  assert.match(output, /Capture coding memory/);
  assert.match(output, /## Current State/);
  assert.match(output, /src\/a\.ts/);
  assert.match(output, /## Next Steps/);
});
