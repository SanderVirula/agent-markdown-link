import { describe, expect, it } from "vitest";

import { selectProject } from "../../src/config/project.js";
import type { ResolvedConfig } from "../../src/config/types.js";

const limits = {
  hookInputBytes: 1_048_576,
  hookOutputBytes: 262_144,
  contextFileBytes: 65_536,
  contextTotalBytes: 131_072,
  candidateBytes: 65_536,
  subprocessOutputBytes: 262_144,
  subprocessTimeoutMs: 10_000,
} as const;

const config: ResolvedConfig = {
  schemaVersion: 1,
  configPath: "/config/config.json",
  vaultRoot: "/vault",
  inboxPath: "Inbox/Agent-Markdown-Link",
  outboxRoot: "/state/outbox",
  stateRoot: "/state",
  captureMode: "explicit",
  writeMode: "outbox",
  hookPolicy: "observe",
  contextExclusions: [],
  projects: [
    {
      projectId: "parent",
      workspaceRoots: ["/work/project"],
      contextFiles: ["Projects/parent.md"],
      searchRoots: [],
      contextExclusions: [],
    },
    {
      projectId: "nested",
      workspaceRoots: ["/work/project/packages/nested"],
      contextFiles: ["Projects/nested.md"],
      searchRoots: [],
      contextExclusions: [],
      limits: { contextFileBytes: 32_768 },
    },
  ],
  limits,
  obsidian: { executable: "obsidian" },
  logging: { maxBytes: 1_048_576, maxFiles: 3 },
  metrics: { enabled: false },
};

describe("project selection", () => {
  it("selects the longest normalized workspace-root match and merges bounded limits", async () => {
    await expect(selectProject(config, "/work/project/packages/nested/./src")).resolves.toMatchObject({
      projectId: "nested",
      workspaceRoot: "/work/project/packages/nested",
      contextExclusions: [],
      limits: { ...limits, contextFileBytes: 32_768 },
    });
  });

  it("matches only complete path-component boundaries", async () => {
    await expect(selectProject(config, "/work/project-other")).resolves.toBeUndefined();
  });

  it("uses Windows lexical semantics independent of the host platform", async () => {
    const windowsConfig: ResolvedConfig = {
      ...config,
      projects: [{ ...config.projects[0]!, workspaceRoots: ["C:\\Work\\Project\\"] }],
    };

    await expect(selectProject(windowsConfig, "c:/work/project/src")).resolves.toMatchObject({
      projectId: "parent",
      workspaceRoot: "C:\\Work\\Project",
    });
  });

  it.each([
    ["POSIX", "/", "/nested/workspace", "/"],
    ["Windows", "C:\\", "c:\\nested\\workspace", "C:\\"],
  ] as const)("matches descendants of a %s filesystem root", async (_name, workspaceRoot, cwd, expected) => {
    const rootConfig: ResolvedConfig = {
      ...config,
      projects: [{ ...config.projects[0]!, workspaceRoots: [workspaceRoot] }],
    };

    await expect(selectProject(rootConfig, cwd)).resolves.toMatchObject({ workspaceRoot: expected });
  });

  it("does not resolve symlink-like lexical aliases through the filesystem", async () => {
    await expect(selectProject(config, "/alias/project/src")).resolves.toBeUndefined();
  });

  it("returns undefined when no project matches", async () => {
    await expect(selectProject(config, "/unmapped/workspace")).resolves.toBeUndefined();
  });

  it("rejects equal-length matches assigned to different project IDs", async () => {
    const ambiguous: ResolvedConfig = {
      ...config,
      projects: [
        { ...config.projects[0]!, projectId: "one", workspaceRoots: ["/work/project"] },
        { ...config.projects[0]!, projectId: "two", workspaceRoots: ["/work/project"] },
      ],
    };

    await expect(selectProject(ambiguous, "/work/project/src")).rejects.toMatchObject({
      code: "E_PROJECT_AMBIGUOUS",
    });
  });
});
