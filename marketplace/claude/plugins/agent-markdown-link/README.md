<p align="center">
  <img src="assets/logo.svg" width="112" alt="Agent Markdown Link logo">
</p>

<h1 align="center">Agent Markdown Link</h1>

<p align="center">
  Curated local Markdown memory for Codex, Claude Code, and Claude Desktop Cowork.
</p>

Agent Markdown Link connects AI agents to explicitly chosen, Obsidian-compatible Markdown notes. It loads curated startup context, offers bounded lexical search when more recall is needed, and stores accepted durable captures as new immutable memory records. It never edits canonical summaries.

Obsidian is optional. It is a convenient editor and review surface, but Agent Markdown Link works while Obsidian is closed or not installed.

## Install

Node.js 22 or newer is required.

```text
# Codex
codex plugin marketplace add SSanderV/agent-markdown-link
codex plugin add agent-markdown-link@agent-markdown-link

# Claude Code or Claude Desktop
claude plugin marketplace add SSanderV/agent-markdown-link
claude plugin install agent-markdown-link@agent-markdown-link
```

Review any host hook prompt, then start a new session after installation.

## Set up

Ask your agent:

> Initialize Agent Markdown Link for this workspace.

The bundled skill locates the guided `init` wizard. You choose the vault, workspace mapping, context files, search roots, an existing automatic-memory folder (or legacy review Inbox), and whether that project should be available to unmapped Cowork sessions. New setups default to automatic memory. The wizard validates the configuration, writes only the local config file, and refuses to overwrite an existing one.

From a source checkout, run the wizard directly:

```text
# macOS/Linux
./node_modules/.bin/agent-markdown init

# Windows PowerShell
.\node_modules\.bin\agent-markdown.cmd init
```

See [Installation](docs/INSTALL.md) for configuration locations, manual setup, upgrades, rollback, and uninstall instructions.

## How it works

1. A project mapping selects ordered context files and optional search roots inside one local Markdown vault.
2. Codex receives curated context at session start; Claude loads it through the bundled local connector.
3. Agents search configured roots plus the shared automatic-memory folder when startup context is insufficient.
4. In the default memory mode, accepted captures become new immutable Markdown records and are searchable immediately. Legacy Inbox review remains opt-in.

Claude Desktop uses a bundled local MCP server, allowing Cowork to reach the same host configuration and vault as Claude Code. Cowork sessions without the Desktop local bridge cannot access the local vault.

## Safety boundaries

- No automatic network, Git, Obsidian, sync, delete, or promotion activity.
- No direct edits to canonical summaries; memory writes create new records and never overwrite notes.
- Search, context, and candidate inputs and outputs are bounded.
- Workspace mappings select startup context. The shared automatic-memory folder is searchable across mapped and default projects; unmapped sessions still fail closed unless you explicitly select a default project.
- Errors are sanitized and do not block the host session.

Vault files and configuration remain local plaintext. Protect the device, vault, backups, and any sync provider. Agent hosts may retain or transmit tool calls under their own policies; see [Security](SECURITY.md) and [Privacy](PRIVACY.md) for the precise boundary.

## CLI

| Command | Purpose |
| --- | --- |
| `init` | Interactively create a validated, no-overwrite configuration. |
| `context` | Read configured context files in order. |
| `search` | Search configured Markdown roots and the shared memory folder using one bounded JSON request on standard input. |
| `capture` | Store one durable memory record (or a legacy review candidate) from a bounded JSON request on standard input. |

Use `--config <absolute-path>` before a command to select a non-default configuration. See the [synthetic example configuration](docs/reference/example-config.json) for the JSON shape.

## Project links

- [Installation](docs/INSTALL.md)
- [Security](SECURITY.md)
- [Privacy](PRIVACY.md)
- [Terms](TERMS.md)
- [Support](SUPPORT.md)
- [Contributing](CONTRIBUTING.md)
- [Changelog](CHANGELOG.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

Licensed under [Apache-2.0](LICENSE). This independent project is not affiliated with Obsidian, OpenAI, or Anthropic.
