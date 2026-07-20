import { spawnSync } from "node:child_process";
import { cp, lstat, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const sourceSkill = path.join(repositoryRoot, "skills", "agent-markdown-link", "SKILL.md");

const expectedFiles = {
  codex: [
    ".codex-plugin/plugin.json",
    "CHANGELOG.md",
    "LICENSE",
    "PRIVACY.md",
    "README.md",
    "SECURITY.md",
    "SUPPORT.md",
    "TERMS.md",
    "THIRD_PARTY_NOTICES.md",
    "assets/icon.svg",
    "assets/logo-dark.svg",
    "assets/logo.svg",
    "docs/INSTALL.md",
    "docs/reference/example-config.json",
    "hooks/hooks.json",
    "runtime/session-start.mjs",
    "skills/agent-markdown-link/SKILL.md",
    "skills/agent-markdown-link/scripts/agent-markdown.env",
    "skills/agent-markdown-link/scripts/agent-markdown.mjs",
  ],
  claude: [
    ".claude-plugin/plugin.json",
    "CHANGELOG.md",
    "LICENSE",
    "PRIVACY.md",
    "README.md",
    "SECURITY.md",
    "SUPPORT.md",
    "TERMS.md",
    "THIRD_PARTY_NOTICES.md",
    "assets/icon.svg",
    "assets/logo-dark.svg",
    "assets/logo.svg",
    "docs/INSTALL.md",
    "docs/reference/example-config.json",
    "hooks/hooks.json",
    "runtime/session-start.mjs",
    "skills/agent-markdown-link/SKILL.md",
    "skills/agent-markdown-link/scripts/agent-markdown.env",
    "skills/agent-markdown-link/scripts/agent-markdown.mjs",
  ],
} as const;

async function inventory(root: string): Promise<readonly string[]> {
  const files: string[] = [];

  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      const relativePath = path.relative(root, fullPath).replaceAll(path.sep, "/");
      const metadata = await lstat(fullPath);
      expect(metadata.isSymbolicLink(), relativePath).toBe(false);
      if (metadata.isDirectory()) await visit(fullPath);
      else if (metadata.isFile()) files.push(relativePath);
    }
  }

  await visit(root);
  return files.sort();
}

async function json(filePath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
}

describe.each(["codex", "claude"] as const)("%s plugin artifact", (host) => {
  const root = path.join(repositoryRoot, "dist", "plugins", host);

  it("contains only the minimal self-contained files", async () => {
    expect(await inventory(root)).toEqual(expectedFiles[host]);
  });

  it("ships the shared skill byte-for-byte", async () => {
    const bundledSkill = path.join(root, "skills", "agent-markdown-link", "SKILL.md");
    expect(await readFile(bundledSkill)).toEqual(await readFile(sourceSkill));
  });

  it("ships the fixed search threadpool environment", async () => {
    const scripts = path.join(root, "skills", "agent-markdown-link", "scripts");
    expect(await readFile(path.join(scripts, "agent-markdown.env"), "utf8")).toBe(
      "UV_THREADPOOL_SIZE=16\n",
    );
    const skill = await readFile(sourceSkill, "utf8");
    expect(skill).toContain("--env-file=");
    expect(skill).toContain("separate single arguments");
    expect(skill).toContain("path contains spaces");
  });

  it("loads the packaged search environment from a path containing spaces", async () => {
    const temporaryRoot = await mkdtemp(path.join(tmpdir(), "agent markdown link "));
    try {
      const scripts = path.join(temporaryRoot, "plugin scripts");
      await cp(path.join(root, "skills", "agent-markdown-link", "scripts"), scripts, {
        recursive: true,
      });
      const envFile = path.join(scripts, "agent-markdown.env");
      const helper = path.join(scripts, "agent-markdown.mjs");
      const child = spawnSync(
        process.execPath,
        [`--env-file=${envFile}`, helper, "--help"],
        {
          cwd: repositoryRoot,
          encoding: "utf8",
          timeout: 10_000,
          windowsHide: true,
        },
      );

      expect(child.error).toBeUndefined();
      expect(child.status).toBe(0);
      expect(child.stderr).toBe("");
      expect(child.stdout).toContain("agent-markdown");
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("bundles the shared search-capable helper", async () => {
    const helper = await readFile(
      path.join(root, "skills", "agent-markdown-link", "scripts", "agent-markdown.mjs"),
      "utf8",
    );

    expect(helper).toContain("agent-markdown [--config <absolute-path>] search");
    expect(helper).toContain("SEARCH_REQUEST_BYTES");
  });

  it("registers only SessionStart using a plugin-root runtime", async () => {
    const hooks = await json(path.join(root, "hooks", "hooks.json"));
    const registrations = hooks.hooks as Record<
      string,
      readonly { readonly hooks: readonly Record<string, unknown>[] }[]
    >;
    expect(Object.keys(registrations)).toEqual(["SessionStart"]);
    const commandHook = registrations.SessionStart?.[0]?.hooks[0];
    expect(commandHook).toBeDefined();

    if (host === "codex") {
      expect(commandHook).toMatchObject({
        command: 'node "${PLUGIN_ROOT}/runtime/session-start.mjs"',
        commandWindows: 'node "${PLUGIN_ROOT}\\runtime\\session-start.mjs"',
      });
    } else {
      expect(commandHook).toMatchObject({
        command: "node",
        args: ["${CLAUDE_PLUGIN_ROOT}/runtime/session-start.mjs"],
      });
    }

    const serialized = JSON.stringify(hooks);
    expect(serialized).toContain(host === "codex" ? "PLUGIN_ROOT" : "CLAUDE_PLUGIN_ROOT");
    expect(serialized).not.toMatch(/\bagent-markdown(?:\.cmd)?\b/u);
  });
});

it("uses the minimal valid Codex manifest", async () => {
  const manifest = await json(
    path.join(repositoryRoot, "dist", "plugins", "codex", ".codex-plugin", "plugin.json"),
  );

  expect(manifest).toMatchObject({
    name: "agent-markdown-link",
    version: "0.1.0",
    license: "Apache-2.0",
    skills: "./skills/",
  });
  expect(manifest).not.toHaveProperty("apps");
  expect(manifest).not.toHaveProperty("mcpServers");
  expect(manifest).not.toHaveProperty("hooks");
});

it("uses the minimal Claude manifest", async () => {
  const manifest = await json(
    path.join(repositoryRoot, "dist", "plugins", "claude", ".claude-plugin", "plugin.json"),
  );

  expect(manifest).toMatchObject({
    name: "agent-markdown-link",
    version: "0.1.0",
  });
});
