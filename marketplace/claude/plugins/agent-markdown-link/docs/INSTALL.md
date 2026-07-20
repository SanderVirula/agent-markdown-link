# Install Agent Markdown Link

Agent Markdown Link requires Node.js 22 or newer. It uses local Markdown files only; Obsidian does not need to be open or installed.

## Install

Add the marketplace once, then install `agent-markdown-link` from it in the host's plugin manager:

```text
codex plugin marketplace add SanderVirula/agent-markdown-link
codex plugin add agent-markdown-link@agent-markdown-link

claude plugin marketplace add SanderVirula/agent-markdown-link
claude plugin install agent-markdown-link@agent-markdown-link
```

Review and trust any host hook prompt before enabling it. Start a new host session after installation.

## Configure

Create a config file using [the synthetic example](reference/example-config.json). Replace every example path with your own local paths; vault-relative paths use `/`.

The default config location is:

```text
Windows: %APPDATA%\agent-markdown-link\config.json
macOS:   ~/Library/Application Support/agent-markdown-link/config.json
Linux:   ~/.config/agent-markdown-link/config.json
```

The configuration selects a vault root, an Inbox for candidate notes, and project mappings. Each mapping supplies workspace roots, ordered context files, and optional search roots. No fixed vault layout is required.

`AGENT_MARKDOWN_LINK_CONFIG` may override the default with an absolute path. From a source checkout, verify a config with the workspace-local executable:

```text
# macOS/Linux
./node_modules/.bin/agent-markdown --config /absolute/path/to/config.json context

# Windows PowerShell
.\node_modules\.bin\agent-markdown.cmd --config C:\absolute\path\to\config.json context
```

## Upgrade, uninstall, and rollback

To upgrade, refresh the marketplace and plugin, then start a new host session:

```text
codex plugin marketplace upgrade agent-markdown-link
codex plugin add agent-markdown-link@agent-markdown-link

claude plugin marketplace update agent-markdown-link
claude plugin update agent-markdown-link@agent-markdown-link
```

To uninstall:

```text
codex plugin remove agent-markdown-link@agent-markdown-link
claude plugin uninstall agent-markdown-link@agent-markdown-link
```

Your vault, configuration, and review candidates are not removed automatically.

To roll back, pin the marketplace to a previous release tag, reinstall that plugin version, and start a new host session. Do not copy unknown plugin files over a working installation.
