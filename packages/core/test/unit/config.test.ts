import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadConfig } from "../../src/config/load.js";
import { resolveConfigPath, resolveStateRoot } from "../../src/config/locations.js";
import { validateConfig } from "../../src/config/validate.js";

const validConfig = {
  schemaVersion: 1,
  vaultRoot: "/vault",
  inboxPath: "Inbox/Agent-Markdown-Link",
  captureMode: "explicit",
  projects: [
    {
      projectId: "project-a",
      workspaceRoots: ["/work/project-a"],
      contextFiles: ["Projects/project-a.md"],
    },
  ],
} as const;

const maximumLimits = {
  hookInputBytes: 16_777_216,
  hookOutputBytes: 4_194_304,
  contextFileBytes: 1_048_576,
  contextTotalBytes: 4_194_304,
  candidateBytes: 1_048_576,
  subprocessOutputBytes: 16_777_216,
  subprocessTimeoutMs: 60_000,
} as const;

describe("configuration locations", () => {
  it("uses CLI, environment, then platform config precedence", () => {
    expect(
      resolveConfigPath({
        cliPath: "C:\\explicit\\config.json",
        envPath: "C:\\env\\config.json",
        platform: "win32",
        appData: "C:\\AppData",
      }),
    ).toBe("C:\\explicit\\config.json");
    expect(
      resolveConfigPath({
        envPath: "C:\\env\\config.json",
        platform: "win32",
        appData: "C:\\AppData",
      }),
    ).toBe("C:\\env\\config.json");
    expect(resolveConfigPath({ platform: "win32", appData: "C:\\AppData" })).toBe(
      "C:\\AppData\\agent-markdown-link\\config.json",
    );
  });

  it.each(["relative.json", "\\\\server\\share\\config.json", "\\\\?\\C:\\config.json"])(
    "rejects unsafe configuration override %s",
    (cliPath) => {
      expect(() => resolveConfigPath({ cliPath, platform: "win32" })).toThrowError(
        expect.objectContaining({ code: "E_CONFIG_INVALID" }),
      );
    },
  );

  it("resolves macOS and Linux configuration defaults without process-global mutation", () => {
    expect(
      resolveConfigPath({ env: {}, homedir: () => "/Users/tester", platform: () => "darwin" }),
    ).toBe("/Users/tester/Library/Application Support/agent-markdown-link/config.json");
    expect(
      resolveConfigPath({
        env: { XDG_CONFIG_HOME: "/xdg/config" },
        homedir: () => "/home/tester",
        platform: () => "linux",
      }),
    ).toBe("/xdg/config/agent-markdown-link/config.json");
    expect(
      resolveConfigPath({
        env: { XDG_CONFIG_HOME: "relative" },
        homedir: () => "/home/tester",
        platform: () => "linux",
      }),
    ).toBe("/home/tester/.config/agent-markdown-link/config.json");
    expect(
      resolveConfigPath({
        env: { XDG_CONFIG_HOME: "//server/config" },
        homedir: () => "/home/tester",
        platform: () => "linux",
      }),
    ).toBe("/home/tester/.config/agent-markdown-link/config.json");
  });

  it("falls back when Windows environment roots are not absolute local paths", () => {
    expect(
      resolveConfigPath({
        env: { APPDATA: "relative" },
        homedir: () => "C:\\Users\\tester",
        platform: () => "win32",
      }),
    ).toBe("C:\\Users\\tester\\AppData\\Roaming\\agent-markdown-link\\config.json");
    expect(
      resolveStateRoot({
        env: { LOCALAPPDATA: "\\\\server\\share" },
        homedir: () => "C:\\Users\\tester",
        platform: () => "win32",
      }),
    ).toBe("C:\\Users\\tester\\AppData\\Local\\agent-markdown-link");
  });

  it("resolves exact platform state roots including fallbacks", () => {
    expect(
      resolveStateRoot({
        env: { LOCALAPPDATA: "C:\\LocalData" },
        homedir: () => "C:\\Users\\tester",
        platform: () => "win32",
      }),
    ).toBe("C:\\LocalData\\agent-markdown-link");
    expect(
      resolveStateRoot({ env: {}, homedir: () => "C:\\Users\\tester", platform: () => "win32" }),
    ).toBe("C:\\Users\\tester\\AppData\\Local\\agent-markdown-link");
    expect(
      resolveStateRoot({ env: {}, homedir: () => "/Users/tester", platform: () => "darwin" }),
    ).toBe("/Users/tester/Library/Application Support/agent-markdown-link/state");
    expect(
      resolveStateRoot({
        env: { XDG_STATE_HOME: "/xdg/state" },
        homedir: () => "/home/tester",
        platform: () => "linux",
      }),
    ).toBe("/xdg/state/agent-markdown-link");
    expect(
      resolveStateRoot({
        env: { XDG_STATE_HOME: "relative" },
        homedir: () => "/home/tester",
        platform: () => "linux",
      }),
    ).toBe("/home/tester/.local/state/agent-markdown-link");
  });
});

describe("configuration validation and loading", () => {
  it("rejects unknown keys and unsupported schema versions with stable codes", () => {
    expect(() => validateConfig({ schemaVersion: 2, unexpected: true })).toThrowError(
      expect.objectContaining({ code: "E_CONFIG_VERSION" }),
    );
    expect(() => validateConfig({ ...validConfig, unexpected: true })).toThrowError(
      expect.objectContaining({ code: "E_CONFIG_INVALID" }),
    );
  });

  it.each([
    ["relative vault root", { ...validConfig, vaultRoot: "relative/vault" }],
    ["UNC vault root", { ...validConfig, vaultRoot: "\\\\server\\vault" }],
    ["relative outbox root", { ...validConfig, outboxRoot: "relative/outbox" }],
    [
      "relative workspace root",
      { ...validConfig, projects: [{ ...validConfig.projects[0], workspaceRoots: ["relative"] }] },
    ],
    ["absolute inbox", { ...validConfig, inboxPath: "/Inbox" }],
    ["drive-absolute inbox", { ...validConfig, inboxPath: "C:/Inbox" }],
    ["backslash inbox", { ...validConfig, inboxPath: "Inbox\\Candidates" }],
    ["empty inbox segment", { ...validConfig, inboxPath: "Inbox//Candidates" }],
    ["terminal empty inbox segment", { ...validConfig, inboxPath: "Inbox/" }],
    ["dot inbox segment", { ...validConfig, inboxPath: "Inbox/./Candidates" }],
    ["parent inbox segment", { ...validConfig, inboxPath: "Inbox/../Candidates" }],
    ["NUL inbox", { ...validConfig, inboxPath: "Inbox/\u0000Candidates" }],
    [
      "legacy project exclusions key",
      { ...validConfig, projects: [{ ...validConfig.projects[0], exclusions: ["Private"] }] },
    ],
    ["Obsidian arbitrary arguments", { ...validConfig, obsidian: { executable: "obsidian", arguments: [] } }],
    ["relative Obsidian path", { ...validConfig, obsidian: { executable: "tools/obsidian" } }],
  ])("rejects %s", (_name, fixture) => {
    expect(() => validateConfig(fixture)).toThrowError(
      expect.objectContaining({ code: "E_CONFIG_INVALID" }),
    );
  });

  it.each([
    ["hookInputBytes", 16_777_217],
    ["hookOutputBytes", 4_194_305],
    ["contextFileBytes", 1_048_577],
    ["contextTotalBytes", 4_194_305],
    ["candidateBytes", 1_048_577],
    ["subprocessOutputBytes", 16_777_217],
    ["subprocessTimeoutMs", 60_001],
  ] as const)("rejects %s above its absolute maximum", (field, value) => {
    expect(() => validateConfig({ ...validConfig, limits: { [field]: value } })).toThrowError(
      expect.objectContaining({ code: "E_CONFIG_INVALID" }),
    );
  });

  it("accepts exact maxima and materializes exact bounded defaults", () => {
    expect(() => validateConfig({ ...validConfig, limits: maximumLimits })).not.toThrow();
    const resolved = validateConfig(validConfig);

    expect(resolved).toMatchObject({
      writeMode: "outbox",
      hookPolicy: "observe",
      limits: {
        hookInputBytes: 1_048_576,
        hookOutputBytes: 262_144,
        contextFileBytes: 65_536,
        contextTotalBytes: 131_072,
        candidateBytes: 65_536,
        subprocessOutputBytes: 262_144,
        subprocessTimeoutMs: 10_000,
      },
      contextExclusions: [],
      obsidian: { executable: "obsidian" },
      logging: { maxBytes: 1_048_576, maxFiles: 3 },
      metrics: { enabled: false },
    });
    expect(resolved.projects[0]?.searchRoots).toEqual([]);
  });

  it("accepts at most sixteen unique portable search roots", () => {
    const searchRoots = Array.from({ length: 16 }, (_value, index) => `Memory/Area-${index}`);
    const resolved = validateConfig({
      ...validConfig,
      projects: [{ ...validConfig.projects[0], searchRoots }],
    });

    expect(resolved.projects[0]?.searchRoots).toEqual(searchRoots);
  });

  it.each([
    ["parent traversal", ["Memory/../Private"]],
    ["backslash", ["Memory\\Private"]],
    ["absolute path", ["/Private"]],
    ["duplicate", ["Memory", "Memory"]],
    ["seventeen roots", Array.from({ length: 17 }, (_value, index) => `Memory/Area-${index}`)],
  ])("rejects invalid project search roots: %s", (_name, searchRoots) => {
    expect(() =>
      validateConfig({
        ...validConfig,
        projects: [{ ...validConfig.projects[0], searchRoots }],
      }),
    ).toThrowError(expect.objectContaining({ code: "E_CONFIG_INVALID" }));
  });

  it.each([
    ["zero byte limit", { limits: { candidateBytes: 0 } }],
    ["timeout below minimum", { limits: { subprocessTimeoutMs: 99 } }],
    ["context file above total", { limits: { contextFileBytes: 200, contextTotalBytes: 100 } }],
    ["log bytes above maximum", { logging: { maxBytes: 16_777_217 } }],
    ["log files above maximum", { logging: { maxFiles: 11 } }],
  ])("rejects invalid bounded relation: %s", (_name, fragment) => {
    expect(() => validateConfig({ ...validConfig, ...fragment })).toThrowError(
      expect.objectContaining({ code: "E_CONFIG_INVALID" }),
    );
  });

  it("rejects duplicate project IDs and invalid project IDs", () => {
    const duplicate = { ...validConfig, projects: [validConfig.projects[0], validConfig.projects[0]] };
    expect(() => validateConfig(duplicate)).toThrowError(
      expect.objectContaining({ code: "E_CONFIG_INVALID" }),
    );
    expect(() =>
      validateConfig({
        ...validConfig,
        projects: [{ ...validConfig.projects[0], projectId: "Uppercase" }],
      }),
    ).toThrowError(expect.objectContaining({ code: "E_CONFIG_INVALID" }));
  });

  it("rejects project context limits above the global values", () => {
    expect(() =>
      validateConfig({
        ...validConfig,
        limits: { contextFileBytes: 64, contextTotalBytes: 128 },
        projects: [
          {
            ...validConfig.projects[0],
            contextExclusions: ["Private/Notes.md"],
            limits: { contextFileBytes: 65 },
          },
        ],
      }),
    ).toThrowError(expect.objectContaining({ code: "E_CONFIG_INVALID" }));
  });

  it("loads configuration without rewriting it and resolves normalized paths", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agent-markdown-config-"));
    const configPath = join(directory, "config.json");
    const original = `${JSON.stringify({ ...validConfig, vaultRoot: "/vault/./notes" }, null, 2)}\n`;
    await writeFile(configPath, original, "utf8");

    const resolved = await loadConfig({
      cliPath: configPath,
      env: { XDG_STATE_HOME: "/state" },
      homedir: () => "/home/tester",
      platform: () => "linux",
    });

    expect(resolved).toMatchObject({
      configPath,
      stateRoot: "/state/agent-markdown-link",
      vaultRoot: "/vault/notes",
      outboxRoot: "/state/agent-markdown-link/outbox",
      obsidian: { executable: "obsidian" },
    });
    await expect(readFile(configPath, "utf8")).resolves.toBe(original);
  });
});
