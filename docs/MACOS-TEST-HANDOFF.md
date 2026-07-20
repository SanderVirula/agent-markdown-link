# macOS validation handoff

Run this from a clean checkout with Node.js 22 available. This procedure uses a temporary synthetic vault only.

```text
npm ci
npm run ci
claude plugin validate .
```

Create a temporary directory containing a `vault/Memory/Context.md` file and a config based on [`reference/example-config.json`](reference/example-config.json). Point `vaultRoot`, `inboxPath`, and `workspaceRoots` at paths inside that temporary directory. Run:

```text
./node_modules/.bin/agent-markdown --config /absolute/path/to/config.json context
```

Confirm the synthetic context is returned, then use each host's normal plugin install flow to install the built marketplace artifact and start a host session mapped to the synthetic workspace. Confirm the same context loads; do not select a real vault.

```text
codex plugin marketplace add .
codex plugin add agent-markdown-link@agent-markdown-link

claude plugin marketplace add ./
claude plugin install agent-markdown-link@agent-markdown-link
```

Quit both hosts, then remove the test installation and local marketplace:

```text
codex plugin remove agent-markdown-link@agent-markdown-link
codex plugin marketplace remove agent-markdown-link

claude plugin uninstall agent-markdown-link@agent-markdown-link
claude plugin marketplace remove agent-markdown-link
```

Delete the temporary directory. No real vault files, configuration, or candidates should be used or retained. Record the macOS version, Node.js version, host versions, command results, and any permission prompt encountered.
