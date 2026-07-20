# Agent Markdown Link

Agent Markdown Link is a local-only Codex and Claude plugin plus CLI for explicitly curated, Obsidian-compatible Markdown. It loads chosen context, offers bounded lexical search, and writes reviewable candidate notes to an Inbox. It never edits canonical notes.

Obsidian is optional: it can be a convenient editor and review surface, but does not need to be open or installed while Agent Markdown Link runs. This independent project is not affiliated with Obsidian, OpenAI, or Anthropic.

## Install

Node.js 22 or newer is required. Add this marketplace to the host you use:

```text
codex plugin marketplace add SanderVirula/agent-markdown-link
codex plugin add agent-markdown-link@agent-markdown-link

claude plugin marketplace add SanderVirula/agent-markdown-link
claude plugin install agent-markdown-link@agent-markdown-link
```

Full configuration, upgrade, uninstall, and rollback instructions are in [INSTALL](docs/INSTALL.md).

## How it works

1. You configure a local Markdown vault, candidate Inbox, and one or more workspace mappings.
2. The host supplies ordered, curated context at session start.
3. An agent may run a bounded lexical search only when the supplied context is insufficient.
4. An agent may explicitly submit one candidate for human review; you edit, promote, or reject it yourself.

The runtime has no automatic network, Git, Obsidian, sync, canonical-edit, delete, or promotion action. An unmapped workspace contributes no context. A loading error returns a fixed unavailable notice without blocking the host session.

## CLI

From a source checkout, use the workspace-local CLI; global installation is not required.

```text
# macOS/Linux
./node_modules/.bin/agent-markdown --config /absolute/path/to/config.json context

# Windows PowerShell
.\node_modules\.bin\agent-markdown.cmd --config C:\absolute\path\to\config.json context
```

`context` reads the configured files in order. `search` accepts one JSON query on standard input and searches only configured Markdown roots; results are lexical, bounded, and report truncation. `capture` accepts one JSON candidate and creates a relative Inbox path without returning submitted content or an absolute vault path. See [the synthetic configuration](docs/reference/example-config.json).

## Security and project links

All configured files remain local plaintext. Protect the vault, device, backups, and any sync service. Hosts may retain or send an agent tool call according to their own policies; see [SECURITY.md](SECURITY.md) for the precise boundary.

- [Privacy](PRIVACY.md)
- [Terms](TERMS.md)
- [Support](SUPPORT.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)
- [Contributing](CONTRIBUTING.md)
- [Changelog](CHANGELOG.md)

Licensed under [Apache-2.0](LICENSE).
