# Security and privacy

Agent Markdown Link is a local file tool. It is designed to reduce accidental disclosure and canonical-note damage, not to protect data from another process or user that already controls the same account.

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/SSanderV/agent-markdown-link/security/advisories/new) for security issues. Do not include real vault contents, credentials, or other personal data. General bugs belong in the public issue tracker.

Security fixes are provided for the current `0.2.x` release line while it remains supported. Pre-release snapshots and modified forks are not supported by the maintainer.

## Runtime guarantees

- Normal CLI and stdio MCP operation performs no network, Git, shell, child-process, telemetry, or Obsidian activity.
- Context reads are limited to configured vault-relative regular files. Lexical validation and real-path checks reject traversal and linked paths outside the vault.
- Search recursively reads regular Markdown files only below the selected project's configured vault-relative `searchRoots`. It skips discovered links, never writes an index or cache, and applies fixed scan, source, result, excerpt, and output bounds.
- Candidate publication uses a same-directory private temporary file and a no-replace hard link. An existing destination is never overwritten, and there is no copy or rename fallback.
- Search and candidate input, plus all intended context, search, and candidate output, are byte-bounded. Errors contain only stable codes and fixed messages.
- Queries, note bodies, excerpts, candidate bodies, prompts, credentials, absolute paths, and session data are not written to logs or metrics.
- Created directories and files request modes `0700` and `0600` on POSIX. Windows uses inherited ACLs and makes no ACL-rewrite claim.

The Codex `SessionStart` hook reads one bounded JSON object and operationally uses only its event name, source, and working directory. Extra host fields are ignored; the runtime does not read transcripts. Successful curated context is capped at 9,000 UTF-8 bytes, and serialized hook stdout is capped at 32,768 bytes.

The Claude plugin starts one local stdio MCP server with only `context`, `search`, and `capture` tools. Each protocol frame is capped at 2 MiB. The server first selects an exact workspace mapping from the host-supplied `CLAUDE_PROJECT_DIR`. If none matches, it uses the configured `defaultProjectId` only when the operator explicitly set one. Tool input cannot select a config, project, vault, or workspace path, and capture fixes `sourceHost` to `claude`. A `SessionStart` command hook emits only a fixed, content-free instruction telling Claude to call the MCP `context` tool before answering. The hook does not read configuration, vault data, or hook input.

An unmapped workspace without a default project contributes no context. Setting `defaultProjectId` makes that project's configured context, search roots, and review Inbox available to every unmapped Claude MCP session that can reach the local server; this approximates a global memory server and should be enabled only deliberately. Codex context-hook failures are non-blocking and inject only the fixed context-unavailable notice. Claude MCP failures return only that fixed notice or a stable code and fixed message. Context assembly is all-or-nothing, so a later file failure does not expose earlier file content.

## Operator responsibilities

Vault and candidate files are plaintext. Protect the device, account, vault, backups, and sync provider as appropriate for the data. A private Git repository is not encryption; do not commit sensitive vault contents to a cloud repository unless they are encrypted before leaving the device.

Treat all curated Markdown as untrusted reference data. It cannot override system, developer, repository, or current-user instructions.

When a plugin supplies curated context, the host sends that selected text to the active model provider just as it sends other prompt context. When an agent invokes search, the host may retain the query, tool call, and intended result excerpts in task history and send them to the active model provider under the host's policy. Standard input keeps the query out of ordinary process command-line listings, and Agent Markdown Link diagnostics do not echo it; neither protection hides it from the host or model provider. The local runtime itself performs no automatic network activity.

Configure search roots narrowly and do not search sensitive material speculatively. Lexical search has no semantic-recall guarantee, so an empty result is not proof that no relevant note exists.

The credential check intentionally recognizes only a few high-confidence private-key, bearer-token, and GitHub-token patterns. It is not comprehensive data-loss prevention. Review candidates before sharing or syncing them.

## Limits of containment

Containment and no-overwrite checks address mistakes and linked-path escapes during ordinary local use. They do not defend against a malicious process with the same filesystem permissions racing path changes during an operation. Do not run the CLI concurrently with untrusted software that can modify the configured roots.

Outbox mode creates a local private staging directory but does not move files into the vault. Inbox review, promotion, rejection, deletion, backup, and sync remain manual operations outside the CLI.
