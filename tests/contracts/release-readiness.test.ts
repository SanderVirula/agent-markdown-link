import { access, lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

async function json(relativePath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path.join(repositoryRoot, relativePath), "utf8")) as Record<
    string,
    unknown
  >;
}

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

describe("public release surface", () => {
  it("contains the small public documentation and automation set", async () => {
    const required = [
      ".github/workflows/ci.yml",
      "CHANGELOG.md",
      "CONTRIBUTING.md",
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
      "docs/MACOS-TEST-HANDOFF.md",
      "docs/SUBMISSION-TESTS.md",
    ];

    for (const relativePath of required) {
      await expect(access(path.join(repositoryRoot, relativePath))).resolves.toBeUndefined();
    }
  });

  it("documents direct installation and platform configuration", async () => {
    const readme = await readFile(path.join(repositoryRoot, "README.md"), "utf8");
    const install = await readFile(path.join(repositoryRoot, "docs", "INSTALL.md"), "utf8");

    expect(readme).toContain('<img src="assets/logo.svg"');
    expect(readme).toContain("codex plugin marketplace add SSanderV/agent-markdown-link");
    expect(readme).toContain("claude plugin marketplace add SSanderV/agent-markdown-link");
    expect(install).toContain("%APPDATA%\\agent-markdown-link\\config.json");
    expect(install).toContain("~/Library/Application Support/agent-markdown-link/config.json");
    expect(install).toContain("~/.config/agent-markdown-link/config.json");
    expect(install).toMatch(/uninstall/iu);
    expect(install).toMatch(/Node\.js 22/iu);
  });

  it("ships public Codex metadata without inventing an app or MCP server", async () => {
    const manifest = await json("plugins/codex/.codex-plugin/plugin.json");
    const interfaceMetadata = manifest.interface as Record<string, unknown>;

    expect(manifest).toMatchObject({
      name: "agent-markdown-link",
      version: "0.4.0",
      homepage: "https://github.com/SSanderV/agent-markdown-link",
      repository: "https://github.com/SSanderV/agent-markdown-link",
    });
    expect(interfaceMetadata).toMatchObject({
      websiteURL: "https://github.com/SSanderV/agent-markdown-link",
      privacyPolicyURL:
        "https://github.com/SSanderV/agent-markdown-link/blob/main/PRIVACY.md",
      termsOfServiceURL:
        "https://github.com/SSanderV/agent-markdown-link/blob/main/TERMS.md",
      brandColor: "#4F46E5",
      composerIcon: "./assets/icon.svg",
      logo: "./assets/logo.svg",
      logoDark: "./assets/logo-dark.svg",
    });
    expect(interfaceMetadata.defaultPrompt).toHaveLength(3);
    expect(manifest).not.toHaveProperty("apps");
    expect(manifest).not.toHaveProperty("mcpServers");
  });

  it("provides host-native repository marketplace catalogs", async () => {
    const codex = await json(".agents/plugins/marketplace.json");
    const claude = await json(".claude-plugin/marketplace.json");

    expect(codex).toMatchObject({
      name: "agent-markdown-link",
      plugins: [
        {
          name: "agent-markdown-link",
          source: {
            source: "local",
            path: "./marketplace/codex/plugins/agent-markdown-link",
          },
          policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
          category: "Productivity",
        },
      ],
    });
    expect(claude).toMatchObject({
      name: "agent-markdown-link",
      plugins: [
        {
          name: "agent-markdown-link",
          version: "0.4.0",
          source: "./marketplace/claude/plugins/agent-markdown-link",
        },
      ],
    });
  });

  it.each(["codex", "claude"])(
    "keeps the tracked %s marketplace artifact current",
    async (host) => {
      const builtRoot = path.join(repositoryRoot, "dist", "plugins", host);
      const marketplaceRoot = path.join(
        repositoryRoot,
        "marketplace",
        host,
        "plugins",
        "agent-markdown-link",
      );

      expect(await inventory(marketplaceRoot)).toEqual(await inventory(builtRoot));
      for (const relativePath of await inventory(builtRoot)) {
        expect(await readFile(path.join(marketplaceRoot, relativePath))).toEqual(
          await readFile(path.join(builtRoot, relativePath)),
        );
      }
    },
    20_000,
  );

  it("has no dangling release scripts", async () => {
    const packageJson = await json("package.json");
    const scripts = packageJson.scripts as Record<string, string>;

    expect(scripts).not.toHaveProperty("verify:pack");
    expect(scripts).not.toHaveProperty("verify:clean");
    expect(scripts.ci).toBe("npm run build && npm run typecheck && npm run lint && npm run validate:schemas && npm run test:unit && npm run test:integration && npm run test:security && npm run validate:plugins && npm run test:release");
    expect(scripts["test:release"]).toBe(
      "vitest run tests/contracts/release-readiness.test.ts tests/contracts/shared-skill.test.ts",
    );
  });

  it("runs the release gate on Windows, macOS, and Linux", async () => {
    const workflow = await readFile(
      path.join(repositoryRoot, ".github", "workflows", "ci.yml"),
      "utf8",
    );

    expect(workflow).toContain("windows-latest");
    expect(workflow).toContain("macos-latest");
    expect(workflow).toContain("ubuntu-latest");
    expect(workflow).toContain("node-version: 22");
    expect(workflow).toContain("run: npm run ci");
    expect(workflow).toContain("git ls-files --others --exclude-standard -- marketplace");
  });

  it("excludes private development material from the public tree", async () => {
    await expect(access(path.join(repositoryRoot, "docs", "superpowers"))).rejects.toBeDefined();
    await expect(access(path.join(repositoryRoot, "docs", "plans"))).rejects.toBeDefined();

    const machineSpecificPaths = [/[A-Za-z]:\\Users\\[^\\\r\n]+\\/u, /\/Users\/[^/\r\n]+\//u];
    const credentialLiterals = [
      new RegExp(`${["gh", "p", "_"].join("")}[A-Za-z0-9]{36}`, "u"),
      new RegExp(`${["github", "pat"].join("_") + "_"}[A-Za-z0-9_]{20,}`, "u"),
    ];
    const files = [
      "README.md",
      "SECURITY.md",
      "PRIVACY.md",
      "SUPPORT.md",
      "TERMS.md",
      "docs/INSTALL.md",
      "docs/MACOS-TEST-HANDOFF.md",
      "docs/SUBMISSION-TESTS.md",
      "plugins/codex/.codex-plugin/plugin.json",
      "plugins/claude/.claude-plugin/plugin.json",
    ];

    for (const relativePath of files) {
      const contents = await readFile(path.join(repositoryRoot, relativePath), "utf8");
      for (const pattern of [...machineSpecificPaths, ...credentialLiterals]) {
        expect(contents).not.toMatch(pattern);
      }
    }
  });
});
