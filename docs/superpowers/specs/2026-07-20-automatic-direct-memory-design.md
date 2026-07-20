# Automatic Direct Memory Design

**Status:** Approved direction, pending written-spec review
**Date:** 2026-07-20
**Scope:** Smallest reliable replacement for manual candidate promotion

## Goal

Agent Markdown Link should behave like a practical memory system rather than a review queue:

- Codex and Claude decide when a compact, durable memory is worth capturing.
- Every valid, credential-free capture becomes searchable immediately.
- The user does not sort, promote, or reject routine entries.
- Original captured knowledge is preserved without lossy AI classification on the write path.
- Storage remains local, Obsidian-compatible Markdown.

This does not mean storing every chat message. It means that every memory the host agent deliberately submits is stored directly.

## Decision

Add a direct `memory` write mode and make it the default produced by the setup wizard for new installations.

In memory mode, AML creates one immutable Markdown record per capture in one shared vault-relative `memoryPath`. These records are canonical memory. Existing high-signal notes such as `PROFILE.md`, `PREFERENCES.md`, `DECISIONS.md`, and `PROJECTS.md` remain optional startup-context summaries derived from experience; AML does not edit them automatically.

The shared memory root is global across configured projects. Each record keeps `projectId` as provenance metadata, but default retrieval does not use it as an access filter. Users who require genuinely separate memory domains use separate vaults/configurations. Optional scoped search can be considered later, but it is not the default or part of this release.

The existing Inbox remains available as an explicit legacy mode. Automatic AI curation and scheduled jobs are not added.

## Why This Direction

Direct immutable records preserve all submitted knowledge while keeping the write path deterministic. They reuse AML's existing bounded request parser, credential refusal, safe path checks, atomic no-overwrite publication, and sanitized diagnostics.

Automatically editing summary notes would put lossy model judgment and merge behavior on the critical write path. A scheduled curator would retain the queue while adding a scheduler, background model access, delayed availability, and cross-platform failure modes.

Project organization remains provenance metadata rather than a mandatory global-search boundary. AML should not recreate the workspace restriction removed for Cowork.

## Configuration

Configuration schema version 1 receives two additive values:

- `writeMode` accepts `"memory"` in addition to `"inbox"` and `"outbox"`.
- `memoryPath` is an optional vault-relative path.

Validation rules:

- `writeMode: "memory"` requires `memoryPath`.
- `writeMode: "inbox"` requires `inboxPath`.
- `writeMode: "outbox"` retains its current behavior.
- `memoryPath` uses the existing portable vault-relative path rules.
- Existing valid configurations remain valid and retain their current behavior.
- An omitted `writeMode` continues to resolve to `outbox` for backward compatibility.

The setup wizard for new configurations:

1. asks for one existing automatic-memory folder relative to the vault;
2. verifies that it resolves to an existing directory contained by the selected vault;
3. writes `writeMode: "memory"` and `memoryPath`;
4. no longer asks for a review Inbox unless the user explicitly chooses legacy review mode; and
5. displays a concise warning that AML does not configure Git or sync exclusions and that private memory paths must not be published unintentionally.

The wizard never changes Git, Obsidian, sync, or an existing AML configuration.

## Record Format

Memory mode writes a separate file named with the existing timestamp plus random UUID convention:

```text
<memoryPath>/<timestamp>-<uuid>.md
```

The directory must already exist. V1 does not add automatic directory sharding or a new safe-directory-creation primitive.

The record is ordinary Markdown:

```markdown
---
schema: agent-markdown-link/memory
schemaVersion: 1
id: "..."
createdAt: "..."
projectId: "..."
sourceHost: codex
kind: decision
status: memory
title: "..."
---

## Memory

The durable knowledge supplied by the agent.
```

Optional rationale and evidence sections retain their current representation. The existing capture request fields and response envelope remain unchanged in this release to avoid an unrelated public API migration.

Inbox mode continues to serialize the existing candidate schema and status.

## Capture Flow

1. Select the mapped project or configured default project exactly as today.
2. Parse and normalize the existing capture request.
3. Reject malformed, oversized, or recognized credential-bearing input before writing.
4. Serialize either a memory record or legacy candidate according to `writeMode`.
5. In memory mode, publish under `vaultRoot/memoryPath` using the existing no-overwrite publication primitive.
6. Return the sanitized existing capture receipt.

No model, classifier, deduplicator, Git operation, Obsidian invocation, or network call is introduced into this path.

The host skill instructs agents to capture compact, verified, durable knowledge without asking the user to maintain an Inbox. The agent still decides what is durable; AML deterministically stores what it receives.

## Recall Flow

Whenever `memoryPath` is configured, AML automatically includes it in bounded lexical search for every selected project, regardless of the current write mode. This ensures that previously stored direct memories remain retrievable if capture is later disabled or switched to legacy review mode.

Configured search roots continue to work. Duplicate physical files discovered through overlapping roots remain suppressed by the existing canonical-file tracking.

The automatic memory root is not added to SessionStart context. Startup context remains bounded to explicitly selected high-signal notes; direct memories are recalled on demand through search.

Default search spans the shared memory root. `projectId` remains in each record's metadata but does not restrict results. Optional project filtering is deferred.

## Security and Privacy

The following existing invariants remain mandatory:

- local-only operation;
- bounded input, record, traversal, result, and diagnostic sizes;
- high-precision credential refusal before publication;
- vault containment and symlink-safe resolution;
- atomic publication without overwrite;
- fixed sanitized errors;
- no memory content, title, filename, or path in logs or metrics;
- no automatic network, Git, Obsidian, or sync activity; and
- the existing capture kill switch.

Ordinary private or personal information is not rejected merely for being sensitive: the selected local memory folder is responsible for that privacy boundary. Documentation and setup warn that AML cannot guarantee whether Git, Obsidian Sync, iCloud, or another program will copy the folder.

V1 adds no configurable quota. Each capture is already bounded, and a quota could reject valuable memory. Runaway-write limits are deferred until real evidence justifies one.

## Compatibility and Migration

- New setup-wizard configurations default to direct memory.
- Existing `inbox` and `outbox` configurations do not change behavior after upgrade.
- Existing candidate files are not reclassified, moved, deleted, or made searchable automatically.
- Existing outbox files are not migrated automatically.
- Release notes document how an existing user can opt into direct memory by creating a private vault folder, adding `memoryPath`, and setting `writeMode` to `"memory"`.
- The user's local configuration can be updated separately after the released build is installed and verified.

No migration command is added unless real users demonstrate that the documented one-time configuration change is insufficient.

## Public Documentation

README, installation guidance, skill text, MCP tool description, example configuration, security documentation, submission tests, and changelog must consistently state:

- capture stores direct memory by default for new setups;
- every accepted memory is immediately searchable;
- AML creates new records but never overwrites existing notes;
- legacy Inbox review remains opt-in;
- curated startup notes are optional derived views; and
- users own the privacy and sync policy of the chosen memory folder.

## Tests and Acceptance Criteria

Implementation follows test-driven development and must prove:

1. memory-mode configuration accepts a safe `memoryPath` and rejects missing or unsafe paths;
2. existing inbox/outbox configurations remain valid and behave unchanged;
3. the setup wizard emits a valid memory-mode configuration and refuses a missing or escaping memory directory;
4. a capture creates exactly one immutable memory record with the expected schema and no canonical-summary edit;
5. a second write cannot overwrite the first;
6. the newly captured record is immediately returned by normal global search from another mapped project and from the default Cowork project;
7. credential, size, containment, symlink, logging, and sanitized-error tests remain green;
8. no Git, network, Obsidian, or background process is invoked; and
9. packaged Codex and Claude artifacts contain matching direct-memory behavior and guidance.

The full existing CI command must pass on the final artifact.

## Explicitly Deferred

- semantic or embedding retrieval;
- automatic summary-note editing;
- scheduled or background curation;
- model-based classification, promotion, or rejection;
- exact or semantic deduplication;
- deletion, TTL, archival, or compaction;
- monthly or other directory sharding;
- project-scoped retrieval filters;
- automatic migration of candidates or outbox records;
- automatic `.gitignore` edits or sync-provider integration;
- configurable write quotas; and
- renaming the existing capture request/receipt fields.

These are added only after demonstrated need. Direct memory capture and immediate global recall are the complete vertical path for this release.
