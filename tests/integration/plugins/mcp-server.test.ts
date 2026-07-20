import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const runtime = path.join(
  repositoryRoot,
  "dist",
  "plugins",
  "claude",
  "runtime",
  "mcp-server.mjs",
);
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function stringEnvironment(values: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

function textContent(result: unknown): string {
  if (typeof result !== "object" || result === null || !("content" in result)) {
    throw new Error("Expected a synchronous tool result.");
  }
  const content = (result as { readonly content: unknown }).content;
  if (!Array.isArray(content)) throw new Error("Expected tool content.");
  const item = content.find(
    (value): value is { readonly type: "text"; readonly text: string } =>
      typeof value === "object" &&
      value !== null &&
      (value as { readonly type?: unknown }).type === "text" &&
      typeof (value as { readonly text?: unknown }).text === "string",
  );
  if (item === undefined) throw new Error("Expected text content.");
  return item.text;
}

async function sha256(filePath: string): Promise<string> {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

it("serves context, search, and review-only capture over packaged stdio MCP", async () => {
  await expect(access(runtime)).resolves.toBeUndefined();

  const root = await realpath(await mkdtemp(path.join(tmpdir(), "agent-markdown-mcp-")));
  temporaryRoots.push(root);
  const vault = path.join(root, "vault");
  const memory = path.join(vault, "Memory");
  const inbox = path.join(vault, "Inbox");
  const workspace = path.join(root, "workspace");
  await mkdir(memory, { recursive: true });
  await mkdir(inbox);
  await mkdir(workspace);

  const firstSource = path.join(memory, "First.md");
  const secondSource = path.join(memory, "Second.md");
  await writeFile(firstSource, "First curated MCP fact.\n", "utf8");
  await writeFile(secondSource, "Second searchable MCP fact.\n", "utf8");
  const sourceHashes = [await sha256(firstSource), await sha256(secondSource)];

  const configPath = path.join(root, "config.json");
  await writeFile(
    configPath,
    `${JSON.stringify({
      schemaVersion: 1,
      vaultRoot: vault,
      inboxPath: "Inbox",
      captureMode: "explicit",
      writeMode: "inbox",
      limits: {
        hookInputBytes: 2048,
        hookOutputBytes: 4096,
        contextFileBytes: 1024,
        contextTotalBytes: 2048,
        candidateBytes: 2048,
      },
      projects: [
        {
          projectId: "mcp-test",
          workspaceRoots: [workspace],
          contextFiles: ["Memory/First.md"],
          searchRoots: ["Memory"],
        },
      ],
    })}\n`,
    "utf8",
  );

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [runtime],
    cwd: workspace,
    env: stringEnvironment({
      ...process.env,
      AGENT_MARKDOWN_LINK_CONFIG: configPath,
      CLAUDE_PROJECT_DIR: workspace,
    }),
    stderr: "pipe",
  });
  const client = new Client({ name: "agent-markdown-link-test", version: "1.0.0" });

  try {
    await client.connect(transport);
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
      "context",
      "search",
      "capture",
    ]);

    const startup = await client.callTool({ name: "context", arguments: {} });
    expect(startup.isError).not.toBe(true);
    expect(textContent(startup)).toContain("First curated MCP fact.");

    const obsoleteArguments = await client.callTool({
      name: "context",
      arguments: { hookEventName: "SessionStart", sessionId: "session-one" },
    });
    expect(obsoleteArguments.isError).toBe(true);

    const search = await client.callTool({
      name: "search",
      arguments: { query: "searchable MCP" },
    });
    expect(search.isError).not.toBe(true);
    const searchOutput = JSON.parse(textContent(search)) as {
      readonly schemaVersion: number;
      readonly results: readonly { readonly relativePath: string }[];
    };
    expect(searchOutput).toMatchObject({
      schemaVersion: 1,
    });
    expect(searchOutput.results[0]?.relativePath).toBe("Memory/Second.md");

    const capture = await client.callTool({
      name: "capture",
      arguments: {
        kind: "decision",
        title: "Keep MCP capture reviewable",
        proposedKnowledge: "Claude submits review candidates through local MCP.",
      },
    });
    expect(capture.isError).not.toBe(true);
    expect(JSON.parse(textContent(capture))).toMatchObject({
      projectId: "mcp-test",
    });

    const candidates = await readdir(inbox);
    expect(candidates).toHaveLength(1);
    expect(await readFile(path.join(inbox, candidates[0]!), "utf8")).toContain(
      "sourceHost: claude",
    );
    expect([await sha256(firstSource), await sha256(secondSource)]).toEqual(sourceHashes);
  } finally {
    await client.close();
  }
});

it("returns only fixed diagnostics when host configuration is unavailable", async () => {
  await expect(access(runtime)).resolves.toBeUndefined();

  const root = await realpath(await mkdtemp(path.join(tmpdir(), "agent-markdown-mcp-error-")));
  temporaryRoots.push(root);
  const missingConfig = path.join(root, "missing-config.json");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [runtime],
    cwd: root,
    env: stringEnvironment({
      ...process.env,
      AGENT_MARKDOWN_LINK_CONFIG: missingConfig,
      CLAUDE_PROJECT_DIR: root,
    }),
    stderr: "pipe",
  });
  const client = new Client({ name: "agent-markdown-link-test", version: "1.0.0" });

  try {
    await client.connect(transport);
    const context = await client.callTool({ name: "context", arguments: {} });
    expect(context.isError).toBe(true);
    expect(textContent(context)).toBe(
      '{"code":"E_CONFIG_INVALID","message":"Configuration is invalid."}',
    );
    expect(textContent(context)).not.toContain(root);

    const search = await client.callTool({
      name: "search",
      arguments: { query: "private query canary" },
    });
    expect(search.isError).toBe(true);
    expect(textContent(search)).toBe(
      '{"code":"E_CONFIG_INVALID","message":"Configuration is invalid."}',
    );
    expect(textContent(search)).not.toContain("private query canary");
    expect(textContent(search)).not.toContain(root);
  } finally {
    await client.close();
  }
});

it("uses an explicit default project against the same vault when the workspace is unmapped", async () => {
  await expect(access(runtime)).resolves.toBeUndefined();

  const root = await realpath(await mkdtemp(path.join(tmpdir(), "agent-markdown-mcp-default-")));
  temporaryRoots.push(root);
  const vault = path.join(root, "vault");
  const memory = path.join(vault, "Memory");
  const inbox = path.join(vault, "Inbox");
  const mappedWorkspace = path.join(root, "mapped");
  const unmappedWorkspace = path.join(root, "unmapped");
  await mkdir(memory, { recursive: true });
  await mkdir(inbox);
  await mkdir(mappedWorkspace);
  await mkdir(unmappedWorkspace);
  await writeFile(path.join(memory, "Shared.md"), "Same configured vault canary.\n", "utf8");
  const configPath = path.join(root, "config.json");
  await writeFile(
    configPath,
    `${JSON.stringify({
      schemaVersion: 1,
      vaultRoot: vault,
      inboxPath: "Inbox",
      captureMode: "explicit",
      writeMode: "inbox",
      defaultProjectId: "mapped-only",
      projects: [
        {
          projectId: "mapped-only",
          workspaceRoots: [mappedWorkspace],
          contextFiles: ["Memory/Shared.md"],
          searchRoots: ["Memory"],
        },
      ],
    })}\n`,
    "utf8",
  );

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [runtime],
    cwd: unmappedWorkspace,
    env: stringEnvironment({
      ...process.env,
      AGENT_MARKDOWN_LINK_CONFIG: configPath,
      CLAUDE_PROJECT_DIR: unmappedWorkspace,
    }),
    stderr: "pipe",
  });
  const client = new Client({ name: "agent-markdown-link-test", version: "1.0.0" });

  try {
    await client.connect(transport);
    const context = await client.callTool({
      name: "context",
      arguments: {},
    });
    expect(context.isError).not.toBe(true);
    expect(textContent(context)).toContain("Same configured vault canary.");

    const search = await client.callTool({
      name: "search",
      arguments: { query: "configured vault canary" },
    });
    expect(search.isError).not.toBe(true);
    expect(JSON.parse(textContent(search))).toMatchObject({
      results: [{ relativePath: "Memory/Shared.md" }],
    });

    const capture = await client.callTool({
      name: "capture",
      arguments: {
        kind: "fact",
        title: "Cowork reaches the configured vault",
        proposedKnowledge: "An unmapped Cowork session used the explicit default project.",
      },
    });
    expect(capture.isError).not.toBe(true);
    expect(JSON.parse(textContent(capture))).toMatchObject({ projectId: "mapped-only" });
    expect(await readdir(inbox)).toHaveLength(1);
  } finally {
    await client.close();
  }
});

it("fails closed with a distinct error when an unmapped workspace has no default project", async () => {
  await expect(access(runtime)).resolves.toBeUndefined();

  const root = await realpath(await mkdtemp(path.join(tmpdir(), "agent-markdown-mcp-unmapped-")));
  temporaryRoots.push(root);
  const vault = path.join(root, "vault");
  const mappedWorkspace = path.join(root, "mapped");
  const unmappedWorkspace = path.join(root, "unmapped");
  await mkdir(vault);
  await mkdir(mappedWorkspace);
  await mkdir(unmappedWorkspace);
  const configPath = path.join(root, "config.json");
  await writeFile(
    configPath,
    `${JSON.stringify({
      schemaVersion: 1,
      vaultRoot: vault,
      inboxPath: "Inbox",
      captureMode: "explicit",
      projects: [
        {
          projectId: "mapped-only",
          workspaceRoots: [mappedWorkspace],
          contextFiles: [],
        },
      ],
    })}\n`,
    "utf8",
  );

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [runtime],
    cwd: unmappedWorkspace,
    env: stringEnvironment({
      ...process.env,
      AGENT_MARKDOWN_LINK_CONFIG: configPath,
      CLAUDE_PROJECT_DIR: unmappedWorkspace,
    }),
    stderr: "pipe",
  });
  const client = new Client({ name: "agent-markdown-link-test", version: "1.0.0" });

  try {
    await client.connect(transport);
    const context = await client.callTool({ name: "context", arguments: {} });
    expect(context.isError).toBe(true);
    expect(textContent(context)).toBe(
      '{"code":"E_PROJECT_UNMAPPED","message":"No project is mapped for this session."}',
    );
  } finally {
    await client.close();
  }
});
