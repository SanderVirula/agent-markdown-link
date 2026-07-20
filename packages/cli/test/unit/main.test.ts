import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

import { SEARCH_REQUEST_BYTES } from "@agent-markdown-link/core";

import { main } from "../../src/main.js";

const temporaryRoots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "agent-markdown-cli-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function collectingStream(chunks: string[]): Writable {
  return new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk.toString("utf8"));
      callback();
    },
  });
}

async function run(
  argv: readonly string[],
  input: string | Uint8Array = "",
  environment: { readonly cwd?: string; readonly env?: NodeJS.ProcessEnv } = {},
): Promise<{ readonly exitCode: number; readonly stdout: string; readonly stderr: string }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCode = await main(
    argv,
    {
      stdin: Readable.from([typeof input === "string" ? Buffer.from(input, "utf8") : input]),
      stdout: collectingStream(stdout),
      stderr: collectingStream(stderr),
    },
    environment,
  );
  return { exitCode, stdout: stdout.join(""), stderr: stderr.join("") };
}

async function scenario(): Promise<{
  readonly root: string;
  readonly vault: string;
  readonly workspace: string;
  readonly source: string;
  readonly configPath: string;
}> {
  const root = await temporaryRoot();
  const vault = path.join(root, "vault");
  const workspace = path.join(root, "workspace");
  const inbox = path.join(vault, "Inbox");
  const memory = path.join(vault, "Memory");
  const source = path.join(memory, "Profile.md");
  const configPath = path.join(root, "config.json");
  await mkdir(workspace);
  await mkdir(inbox, { recursive: true });
  await mkdir(memory);
  await writeFile(source, "Curated profile context.", "utf8");
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        vaultRoot: vault,
        inboxPath: "Inbox",
        captureMode: "explicit",
        writeMode: "inbox",
        limits: {
          hookOutputBytes: 4096,
          contextFileBytes: 1024,
          contextTotalBytes: 2048,
          candidateBytes: 1024,
        },
        projects: [
          {
            projectId: "project-a",
            workspaceRoots: [workspace],
            contextFiles: ["Memory/Profile.md"],
            searchRoots: ["Memory"],
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return { root, vault, workspace, source, configPath };
}

describe("CLI usage", () => {
  it("prints only the minimal command surface for help", async () => {
    const result = await run(["--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("agent-markdown [--config <absolute-path>] context");
    expect(result.stdout).toContain("agent-markdown [--config <absolute-path>] search");
    expect(result.stdout).toContain("agent-markdown [--config <absolute-path>] capture");
    expect(result.stdout).not.toMatch(/receipt|flush|obsidian|doctor|status/iu);
  });

  it.each([["unknown"], ["--unknown"], ["-h"], ["context", "extra"]])(
    "rejects unsupported arguments %j",
    async (...argv) => {
      const result = await run(argv);
      expect(result.exitCode).toBe(2);
      expect(JSON.parse(result.stderr)).toEqual({ code: "E_INPUT_INVALID", message: "Input is invalid." });
      expect(result.stdout).toBe("");
    },
  );

  it("rejects a relative config override as usage input", async () => {
    const result = await run(["--config", "relative.json", "context"]);
    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stderr)).toEqual({ code: "E_INPUT_INVALID", message: "Input is invalid." });
  });

  it("rejects a working directory with no project mapping", async () => {
    const setup = await scenario();
    const result = await run(["--config", setup.configPath, "context"], "", {
      cwd: setup.root,
    });

    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stderr)).toEqual({ code: "E_INPUT_INVALID", message: "Input is invalid." });
  });
});

describe("CLI operations", () => {
  it("writes plain bounded context to stdout", async () => {
    const setup = await scenario();
    const result = await run(["--config", setup.configPath, "context"], "", {
      cwd: setup.workspace,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Agent Markdown Link curated context follows.");
    expect(result.stdout).toContain("Curated profile context.");
    expect(result.stdout).not.toMatch(/^\s*\{/u);
  });

  it("reads one candidate object and writes compact result JSON", async () => {
    const setup = await scenario();
    const request = {
      schemaVersion: 1,
      sourceHost: "claude",
      kind: "decision",
      title: "Use the reviewed workflow",
      proposedKnowledge: "Candidate memories require human review.",
    };
    const result = await run(
      ["--config", setup.configPath, "capture"],
      `${JSON.stringify(request)}\n`,
      { cwd: setup.workspace },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(result.stdout) as {
      readonly candidateId: string;
      readonly projectId: string;
      readonly relativePath: string;
    };
    expect(Object.keys(parsed)).toEqual(["candidateId", "projectId", "relativePath"]);
    expect(parsed.projectId).toBe("project-a");
    expect(parsed.relativePath.startsWith("Inbox/")).toBe(true);
    const markdown = await readFile(path.join(setup.vault, ...parsed.relativePath.split("/")), "utf8");
    expect(markdown).toContain("sourceHost: claude");
    expect(markdown).toContain("status: candidate");
  });

  it("reads one bounded search object and writes compact result JSON", async () => {
    const setup = await scenario();
    const request = `${" ".repeat(1_200)}${JSON.stringify({
      schemaVersion: 1,
      query: "profile context",
    })}`;
    expect(Buffer.byteLength(request, "utf8")).toBeLessThanOrEqual(SEARCH_REQUEST_BYTES);
    const result = await run(["--config", setup.configPath, "search"], request, {
      cwd: setup.workspace,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(result.stdout) as {
      readonly schemaVersion: number;
      readonly searchedFiles: number;
      readonly truncated: boolean;
      readonly results: readonly { readonly relativePath: string; readonly snippet: string }[];
    };
    expect(result.stdout).toBe(`${JSON.stringify(parsed)}\n`);
    expect(parsed).toMatchObject({ schemaVersion: 1, searchedFiles: 1, truncated: false });
    expect(parsed.results[0]?.relativePath).toBe("Memory/Profile.md");
    expect(parsed.results[0]?.snippet).toContain("profile context");
    expect(result.stdout).not.toContain(setup.root);
  });

  it.each([
    [JSON.stringify({ schemaVersion: 1, query: "x" }), "E_INPUT_INVALID"],
    ["x".repeat(SEARCH_REQUEST_BYTES + 1), "E_SIZE_LIMIT"],
  ])("maps invalid search input to exit 2 without echoing it", async (input, code) => {
    const setup = await scenario();
    const result = await run(["--config", setup.configPath, "search"], input, {
      cwd: setup.workspace,
    });

    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stderr)).toMatchObject({ code });
    expect(result.stderr).not.toContain(input.slice(0, 20));
    expect(result.stdout).toBe("");
  });

  it("maps search failures to sanitized exit 1 diagnostics", async () => {
    const setup = await scenario();
    const queryCanary = "PRIVATE_QUERY_CANARY";
    const excerptCanary = "PRIVATE_EXCERPT_CANARY";
    await writeFile(
      setup.source,
      Buffer.concat([Buffer.from(excerptCanary, "utf8"), Buffer.from([0xc3, 0x28])]),
    );
    const result = await run(
      ["--config", setup.configPath, "search"],
      JSON.stringify({ schemaVersion: 1, query: queryCanary }),
      { cwd: setup.workspace },
    );

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stderr)).toEqual({
      code: "E_INTERNAL",
      message: "Internal operation failed.",
    });
    expect(result.stderr).not.toContain(queryCanary);
    expect(result.stderr).not.toContain(excerptCanary);
    expect(result.stderr).not.toContain(setup.root);
    expect(result.stdout).toBe("");
  });

  it.each([
    ["invalid JSON", "{not json", "E_INPUT_INVALID"],
    ["trailing JSON", `${JSON.stringify({ schemaVersion: 1 })}{}`, "E_INPUT_INVALID"],
    ["oversized input", "x".repeat(1025), "E_SIZE_LIMIT"],
  ])("rejects %s without echoing input", async (_name, input, code) => {
    const setup = await scenario();
    const result = await run(["--config", setup.configPath, "capture"], input, {
      cwd: setup.workspace,
    });

    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stderr)).toMatchObject({ code });
    expect(result.stderr).not.toContain(input.slice(0, 20));
  });

  it("rejects invalid UTF-8 candidate input", async () => {
    const setup = await scenario();
    const result = await run(["--config", setup.configPath, "capture"], Buffer.from([0xc3, 0x28]), {
      cwd: setup.workspace,
    });

    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stderr)).toEqual({ code: "E_INPUT_INVALID", message: "Input is invalid." });
  });

  it("sanitizes operational errors without paths or submitted credentials", async () => {
    const setup = await scenario();
    await unlink(setup.source);
    const result = await run(["--config", setup.configPath, "context"], "", {
      cwd: setup.workspace,
    });

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stderr)).toEqual({ code: "E_INTERNAL", message: "Internal operation failed." });
    expect(result.stderr).not.toContain(setup.root);
  });
});
