# Story Hook-Based Engineering Memory Design

## Context

This design defines a portable, hook-based Story system under `/Users/bytedance/Desktop/super/story` that captures coding-session evidence at commit time and layers reusable skills on top of that evidence. The goal is a publishable, team-adoptable package that can be installed into other repositories with minimal manual setup. The implementation will prioritize native Git workflows: users keep using `git commit`, while Story hooks attach checkpoint/session metadata and maintain a repository-local engineering memory layer.

The design is based on three inputs:
- the Story mechanism notes already summarized from the `story机制` wiki,
- the earlier Git-as-database and binding analysis,
- the user's additional notes in the referenced private wiki.

Because the current session is token-constrained, this document intentionally ends at design scope and does not begin implementation.

## Goals

1. Capture session/checkpoint metadata automatically during normal Git commit flows via hooks.
2. Persist raw evidence and structured metadata in a Git-native, repository-owned layout that is portable across machines and collaborators.
3. Bind commits to checkpoints in a way that survives SHA rewrites such as amend, rebase, squash, merge, and cherry-pick.
4. Provide user-facing Story skills for:
   - viewing coding conversations related to the current commit,
   - generating a coding review document from commit-linked session evidence,
   - handing off context and reviewing intent later.
5. Package the mechanism so another user can install it into a repository and use it without reading implementation internals.

## Non-Goals

1. Building a remote SaaS or central database for checkpoint storage.
2. Replacing Git hosting platforms or implementing a full forge.
3. Capturing every possible IDE/editor transcript on day one.
4. Perfect attribution at line granularity.
5. Solving permission, privacy, or secret-redaction policy for every environment in this first release.

## Product Shape

The deliverable under `/Users/bytedance/Desktop/super/story` will be a standalone toolkit with four layers:

1. **Core runtime**: local repository state management, canonical checkpoint/session models, hashing, serialization, lookup, and review generation.
2. **Git integration**: installation command plus managed hooks (`commit-msg`, `post-commit`, `post-rewrite`) that cooperate with normal `git` commands.
3. **Storage layer**: a repository-owned Story area for runtime scratch plus a Git-managed checkpoint branch/ref for durable evidence.
4. **Skill layer**: reusable skills that consume the stored evidence to answer practical workflows like commit conversation lookup and review doc generation.

## Recommended Delivery Approach

I recommend a dual-surface architecture with **hooks as the primary integration surface** and **CLI commands as the implementation/control surface**.

- Users continue using `git commit`, `git rebase`, `git cherry-pick`, etc.
- Managed hooks call the Story CLI to perform metadata work.
- Skills invoke the same CLI/library functions to inspect and transform stored checkpoint evidence.

This gives the least workflow disruption while keeping the actual logic centralized and testable.

## Architecture Overview

### 1. Repository Layout

The Story package will create and manage these repository-local paths:

```text
story/
  README.md
  package.json
  src/
  skills/
  templates/
  bin/
  test/

.story/
  runtime/
    current-session.json
    pending-commit.json
    install.json
  cache/
  generated/
  reviews/
  handoffs/
  logs/
```

And it will use a dedicated Git ref/branch for durable checkpoint content:

```text
refs/heads/story/checkpoints/v1
```

### 2. Split Between Runtime State and Durable Evidence

There are two distinct data classes:

#### Runtime state
Ephemeral local files under `.story/runtime/` track the currently active session and the next commit's pending checkpoint context.

Examples:
- active session identity,
- source transcript path(s),
- normalized transcript hash,
- staged file list snapshot,
- branch name,
- hook installation status.

This data can be regenerated or cleared locally.

#### Durable evidence
Commit-linked checkpoint artifacts live in the Story checkpoint ref and are the audit-grade source of truth.

Examples:
- full normalized transcript,
- original prompt,
- session metadata,
- generated summary,
- review-ready extracted decision log,
- commit linkage metadata.

### 3. Data Model

#### Session
A session is the evidence collected from one coding conversation source.

```json
{
  "session_id": "sess_20260720_xxx",
  "agent": "codex",
  "model": "unknown-or-detected",
  "source_kind": "codex-transcript",
  "source_path": "...",
  "branch": "feature/foo",
  "started_at": "2026-07-20T00:00:00Z",
  "updated_at": "2026-07-20T00:10:00Z",
  "files_touched": ["a.ts", "b.ts"],
  "prompt": "...",
  "session_sha": "sha256:..."
}
```

#### Checkpoint
A checkpoint is the durable commit-time capture generated from one or more sessions.

```json
{
  "checkpoint_id": "cp_06e92304186b_0",
  "version": 1,
  "session_ids": ["sess_20260720_xxx"],
  "session_shas": ["sha256:..."],
  "branch": "feature/foo",
  "tree_sha": "...",
  "parent_sha": "...",
  "commit_sha": "...",
  "content_hash": "sha256:...",
  "created_at": "2026-07-20T00:12:00Z",
  "files_changed": ["a.ts", "b.ts"],
  "summary": "...",
  "review_status": "not_generated"
}
```

#### Commit Binding
Commit binding is represented redundantly in two places:

1. **Commit trailers** in the Git commit message.
2. **Checkpoint metadata** in durable storage.

Recommended trailers:

```text
Story-Checkpoint: cp_06e92304186b_0
Story-Session: sess_20260720_xxx
Story-Session-SHA: sha256:...
Story-Content-Hash: sha256:...
```

For multi-session commits, the same trailer key may repeat.

## Git-as-Database Design

### Why Git
The checkpoint store should travel with the repository, clone/fetch naturally, and remain available offline. Git already gives distribution, audit history, repository ownership, and familiar operational semantics.

### Checkpoint Ref Layout
The checkpoint ref stores normalized files by checkpoint identifier, sharded for scalability.

```text
story/checkpoints/v1/
  06/
    e92304186b/
      metadata.json
      0/
        full.jsonl
        prompt.txt
        metadata.json
        review.md
        content_hash.txt
```

### Storage Semantics
- The checkpoint ref is append-only by policy.
- Durable evidence is never silently rewritten.
- If later enrichment is needed, a new checkpoint revision or additional artifact file is written rather than mutating history in place.
- Local runtime state may be rewritten freely.

## Hook-Based Integration

### Hook Installation
`story enable` will install managed hooks into the current repository. The hook scripts themselves stay small and delegate to the Story CLI.

Managed hooks:
- `commit-msg`
- `post-commit`
- `post-rewrite`

Optional later hooks:
- `prepare-commit-msg`
- `post-merge`
- `pre-push`

### `commit-msg` responsibilities
This hook runs before the commit is finalized.

Responsibilities:
1. Read current session state from `.story/runtime/current-session.json`.
2. Resolve all sessions involved in the pending commit.
3. Construct or reserve a checkpoint identity.
4. Append missing Story trailers to the commit message using Git-native trailer semantics.
5. Persist a pending linkage file for post-commit finalization.

This stage must not require the final commit SHA yet.

### `post-commit` responsibilities
This hook runs after the commit exists.

Responsibilities:
1. Read `HEAD` to get the final commit SHA.
2. Finalize the checkpoint metadata with commit SHA, tree SHA, and parent SHA.
3. Materialize durable checkpoint artifacts.
4. Commit or stage those artifacts into the checkpoint ref.
5. Update local indexes and caches for quick lookup.

### `post-rewrite` responsibilities
This hook handles history rewriting operations.

Responsibilities:
1. Read old->new SHA mappings emitted by Git.
2. Re-parse Story trailers from rewritten commits.
3. Rebuild lookup indexes for new SHAs.
4. Add lineage metadata showing that a checkpoint remained logically bound across rewritten commit objects.

This hook is the backbone of rewrite resilience.

## Binding Strategy

### Primary binding rule
The authoritative logical binding is:

**commit message trailers -> checkpoint/session identifiers**

This survives many history rewrite flows better than a naked external `commit_sha -> checkpoint_id` table.

### Secondary binding rule
The authoritative physical evidence is:

**checkpoint metadata -> observed commit/tree/parent/content hashes**

This supports traceability and audit after the commit exists.

### Why both are necessary
- Trailer binding is resilient to SHA churn.
- Checkpoint metadata is necessary for audit, search, and deterministic lookup.
- Together they provide portability, survivability, and verifiability.

## Session Ingestion Strategy

This first release needs a practical ingestion strategy because hook logic only works if session evidence is already discoverable.

### Phase 1 input model
For the first release, Story will support explicit or semi-automatic session registration from local transcript sources.

Possible inputs:
- a transcript file path,
- a directory of session JSONL files,
- a current-session marker produced by a wrapper command,
- future adapters for Codex/Claude/Cursor-specific exports.

Recommended first-release rule:

- `story session attach <path>` registers the transcript to use for subsequent commits.
- `story session status` shows what will be attached to the next commit.
- Hooks consume this pre-registered session state.

This avoids over-promising automatic discovery across every agent runtime in v1.

## User-Facing CLI Surface

Recommended commands:

```bash
story enable
story disable
story status
story session attach <path>
story session status
story checkpoint show --commit HEAD
story checkpoint list
story review generate --commit HEAD
story handoff commit --commit HEAD
story export installable
```

### Command responsibilities
- `enable`: install hooks and bootstrap repo state.
- `status`: show installation, active session, pending checkpoint info.
- `session attach`: register transcript(s) for the next commit.
- `checkpoint show`: display commit-linked checkpoint metadata and artifacts.
- `review generate`: produce a review doc from checkpoint evidence.
- `handoff commit`: generate a concise handoff from linked evidence.
- `export installable`: package the toolkit or copy installation assets for reuse.

## Skill Layer Design

The Story package should include reusable skills under `story/skills/` so users can install or copy the Story mechanism and immediately get agent-facing workflows.

### Skill 1: `story-current-commit-session`
Purpose: inspect the coding conversation linked to the current commit.

Behavior:
1. Resolve `HEAD` or a specified commit.
2. Parse Story trailers.
3. Load checkpoint metadata and relevant transcript excerpts.
4. Present a structured explanation of:
   - original prompt,
   - key decisions,
   - files changed,
   - failures/corrections if extractable,
   - review-relevant rationale.

### Skill 2: `story-review-doc`
Purpose: generate a coding review document from commit-linked evidence.

Behavior:
1. Resolve one commit or a range.
2. Collect linked checkpoints.
3. Extract intent, constraints, touched files, and major decisions.
4. Emit a Markdown review document under `.story/reviews/` or a user-specified path.
5. Include sections for intent review and execution review.

### Skill 3: `story-handoff-commit`
Purpose: create a handoff document from commit-linked session evidence.

Behavior:
1. Resolve commit.
2. Summarize original objective, completed work, unresolved issues, and next steps.
3. Write a handoff artifact under `.story/handoffs/`.

### Skill 4: `using-story`
Purpose: route natural-language requests to the right Story workflow.

Behavior:
- If user asks "show me the conversation behind this commit", route to current-commit-session.
- If user asks for review material, route to story-review-doc.
- If user asks to continue work elsewhere, route to handoff.

## Review Document Design

The generated coding review document should be optimized for human and agent review.

Recommended sections:

```markdown
# Story Review: <commit or range>

## Intent Review
- Original objective
- Constraints and non-goals
- Expected behavior

## Execution Review
- Files changed
- Key implementation decisions
- Tests/evidence observed
- Risks and unresolved questions

## Transcript Evidence
- Important excerpts or summarized decision points

## Reviewer Checklist
- Requirement fit
- Intent drift
- Risk hotspots
```

The review doc is a secondary artifact derived from raw evidence, not a replacement for it.

## Portability and Migration Design

To be easily migrated to other repositories and users, the package should be self-contained.

### Portability requirements
1. No hardcoded machine-specific paths in runtime logic.
2. Hook scripts reference the local `story` installation relative to repository root.
3. Installation command can bootstrap from a copied folder or package install.
4. Skills live with the Story package and can be installed or symlinked with documented commands.
5. Generated runtime state lives under repo-local `.story/`, never in a user-global hidden service directory by default.

### Installation paths
Support two install modes:

1. **Vendored mode**: copy `story/` into a repository and run `story enable`.
2. **Package mode**: install from package registry or git source and run bootstrap into the current repo.

### Migration docs must cover
- prerequisites,
- install steps,
- hook behavior,
- session attach workflow,
- checkpoint ref sync strategy,
- backup/cleanup,
- compatibility notes,
- trust/privacy expectations.

## Packaging Recommendation

A Node.js/TypeScript implementation is recommended for this package because:
- it is easy to distribute as a CLI,
- it can manipulate files and Git subprocesses cleanly,
- it is well suited for JSON-heavy artifact management,
- skill/template shipping is straightforward.

Recommended package structure:

```text
story/
  package.json
  README.md
  bin/story.js
  src/
    cli/
    core/
    git/
    hooks/
    skills/
    templates/
  skills/
    using-story/
    story-current-commit-session/
    story-review-doc/
    story-handoff-commit/
```

## Error Handling Design

### Commit path safety rules
1. If no session is attached, commit should still succeed by default unless strict mode is enabled.
2. If trailer injection fails, the hook should fail closed only in strict mode.
3. If post-commit checkpoint persistence fails, the user should get a clear warning and remediation command.
4. Hook logic must avoid recursive Git invocations against the main working ref.

### Recovery commands
Recommended support commands:

```bash
story repair
story checkpoint rebuild --commit <sha>
story index rebuild
```

## Security and Privacy Considerations

This first release must at least account for these concerns in design:

1. Session transcripts may contain secrets or sensitive prompts.
2. Review docs and handoff docs may leak more context than a user expects.
3. Checkpoint ref propagation means evidence travels with Git fetch/push.

Recommended initial controls:
- explicit documentation that transcripts are durable evidence,
- optional redaction pipeline hook point before persistence,
- configurable allow/deny patterns for transcript inclusion,
- local-only mode as a future extension.

## Testing Strategy

### Unit tests
- hash generation,
- trailer parsing/rendering,
- checkpoint ID generation,
- metadata serialization,
- session attach state transitions.

### Integration tests
- `story enable` installs hooks correctly,
- `git commit` injects trailers,
- `post-commit` materializes checkpoint artifacts,
- `git commit --amend` preserves logical binding,
- `git rebase` and `post-rewrite` rebuild lookup correctly,
- review doc generation resolves the right checkpoint.

### Acceptance tests
- a new user can copy/install the package into another repo,
- attach a transcript,
- make a commit,
- inspect the linked session,
- generate a review document,
- and hand the repository to another user who can reproduce the lookup.

## Open Questions Deferred to Planning

These are intentionally postponed to the implementation-planning phase, not blocked here:

1. Exact transcript adapter contracts for Codex/Claude/Cursor.
2. Whether checkpoint ref updates are written as direct plumbing commands or via a temporary detached worktree.
3. Whether review documents should be committed or remain generated local artifacts by default.
4. Whether `story enable` should install hooks into `.git/hooks` directly or use `core.hooksPath`.
5. Whether multi-session aggregation is automatic or explicit in v1.

## Recommended Initial Implementation Slice

For the first development milestone, build the smallest publishable vertical slice:

1. Node/TypeScript CLI skeleton.
2. `story enable` hook installation.
3. `story session attach <path>`.
4. `commit-msg` trailer injection.
5. `post-commit` checkpoint artifact persistence.
6. `story checkpoint show --commit HEAD`.
7. `story review generate --commit HEAD`.
8. `story-current-commit-session` and `story-review-doc` skills.
9. README + migration/install guide.

This slice proves the core claim: standard Git commits can automatically produce portable engineering memory and power higher-level agent workflows.

## Proposed Next Step

After approval, the next session should create a detailed implementation plan for the Story package under `/Users/bytedance/Desktop/super/story`, including exact file layout, task decomposition, tests, and skill asset generation.
