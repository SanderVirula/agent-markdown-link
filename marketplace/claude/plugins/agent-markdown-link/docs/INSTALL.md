# Install Agent Markdown Link

Agent Markdown Link requires Node.js 22 or newer. It uses local Markdown files only; Obsidian does not need to be open or installed.

## Install

Add the marketplace once, then install `agent-markdown-link` from it in the host's plugin manager:

```text
codex plugin marketplace add SSanderV/agent-markdown-link
codex plugin add agent-markdown-link@agent-markdown-link

claude plugin marketplace add SSanderV/agent-markdown-link
claude plugin install agent-markdown-link@agent-markdown-link
```

Review and trust any host hook prompt before enabling it. Start a new host session after installation.

For Cowork, install and enable the plugin in Claude Desktop. The bundled MCP server runs locally through Desktop and reads the normal host configuration; no configuration or vault copy belongs inside the Cowork sandbox. Cowork sessions without the Desktop local bridge cannot access the local vault.

## Guided setup

After installation, ask your agent to **initialize Agent Markdown Link for this workspace**. The installed skill resolves its bundled helper and gives you the exact `node <absolute-script> init` command to run in an interactive local terminal.

From a source checkout, the equivalent commands are:

```text
# macOS/Linux
./node_modules/.bin/agent-markdown init

# Windows PowerShell
.\node_modules\.bin\agent-markdown.cmd init
```

The wizard asks for one vault, workspace mapping, project ID, ordered context files, search roots, an existing automatic-memory folder, and optional Cowork default. Automatic memory is the default; choose `inbox` only for legacy review. It validates the config and existing vault/workspace roots, writes only the local config file, and refuses to overwrite one that already exists. It never creates or edits vault notes or folders. Create the chosen memory folder (or Inbox) and any referenced files or folders in your vault before using their paths. The wizard does not configure Git or sync exclusions, so do not publish private memory unintentionally.

Use `--config <absolute-path>` before `init` to write a non-default config location.

## Manual configuration

Create a config file using [the synthetic example](reference/example-config.json). Replace every example path with your own local paths; vault-relative paths use `/`.

The default config location is:

```text
Windows: %APPDATA%\agent-markdown-link\config.json
macOS:   ~/Library/Application Support/agent-markdown-link/config.json
Linux:   ~/.config/agent-markdown-link/config.json
```

The configuration selects a vault root, one shared vault-relative `memoryPath` for automatic records, and project mappings. Each mapping supplies workspace roots, ordered context files, and optional search roots. `memoryPath` is searched for every mapped or default project; `projectId` is provenance in each record, not a retrieval boundary. No fixed vault layout is required. Existing users may opt in manually: create an existing private vault folder, set `writeMode` to `memory`, and set `memoryPath`. Existing Inbox and outbox configurations remain compatible.

Claude Desktop Cowork may report a workspace path that cannot match a host mapping. To give such sessions the same configured vault, set the optional top-level `defaultProjectId` to one existing project ID. Exact workspace matches still win. Without this explicit setting, unmapped sessions fail closed. Every mapped or default project can search the shared `memoryPath`; choose a vault/configuration whose trust boundary is appropriate.

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

Your vault, configuration, memory records, and legacy review candidates are not removed automatically.

To roll back, pin the marketplace to a previous release tag, reinstall that plugin version, and start a new host session. Do not copy unknown plugin files over a working installation.
