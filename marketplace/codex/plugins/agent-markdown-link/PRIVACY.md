# Privacy

Agent Markdown Link reads only explicitly configured Markdown files and writes only review candidates to the configured local destination. Configuration, notes, and candidates remain on the user's device until the user moves, syncs, backs up, or deletes them.

The runtime has no analytics, telemetry, account system, or automatic network activity. Claude's bundled MCP adapter communicates only over local standard input and output. It does not collect personal information for the project maintainer. Uninstalling the plugin does not delete the user's vault, configuration, or candidates.

When the plugin supplies context or an agent invokes search, the selected text, query, tool call, or result may be retained or sent to the active model provider by Codex or Claude under that host's policy. Users are responsible for the contents and protection of their vault, device, backups, and any sync service.

If `defaultProjectId` is configured, every unmapped Claude MCP session that can reach the local server may use that project's configured context, search roots, and review Inbox. Leave it unset when that broader local-session scope is not appropriate.

Questions may be filed through [GitHub Issues](https://github.com/SSanderV/agent-markdown-link/issues).
