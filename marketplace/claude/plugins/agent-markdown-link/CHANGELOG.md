# Changelog

## 0.4.2 - 2026-07-21

- Preserve usable Codex startup context when configured notes exceed the hook output limit by packing complete notes in order and reporting bounded omissions.
- Retain fail-closed per-file validation, bounded reads, and deterministic output while continuing to later notes that still fit.

## 0.4.1 - 2026-07-20

- Standardize public marketplace and plugin author metadata on `SSanderV`.

## 0.4.0 - 2026-07-20

- Store accepted durable captures as immutable, immediately searchable local Markdown memory by default for new setups.
- Add one shared `memoryPath` across mapped and default projects while retaining opt-in legacy Inbox and outbox behavior.

## 0.3.0 - 2026-07-20

- Add a guided, no-overwrite `init` command for local configuration.
- Simplify the Claude MCP `context` tool to its intended empty input object.
- Update public repository and marketplace links for the renamed GitHub account.

## 0.2.2 - 2026-07-20

- Add an explicit default-project fallback so Claude Desktop Cowork can use the same configured local vault when its workspace path cannot match a host mapping.

## 0.2.1 - 2026-07-20

- Fix Claude Desktop Cowork marketplace validation by using a compatible startup reminder to load context through the bundled local MCP connector.

## 0.2.0 - 2026-07-20

- Add a bundled local stdio MCP adapter for Claude Code and Claude Desktop Cowork, including curated context, bounded search, and review-only capture.

## 0.1.0 - 2026-07-20

- Initial release with local curated Markdown context, bounded lexical search, explicit review-candidate capture, and Codex and Claude plugin packages.
