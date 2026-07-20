import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const temporaryRoots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "agent-markdown-vertical-")));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function runCli(
  args: readonly string[],
  options: { readonly cwd: string; readonly env: NodeJS.ProcessEnv; readonly input?: string },
): Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }> {
  const bin = path.join(
    repositoryRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "agent-markdown.cmd" : "agent-markdown",
  );
  const child =
    process.platform === "win32"
      ? spawn(
          process.env.ComSpec ?? "cmd.exe",
          ["/d", "/s", "/c", bin, ...args],
          { cwd: options.cwd, env: options.env, windowsHide: true },
        )
      : spawn(bin, [...args], { cwd: options.cwd, env: options.env });
  return collectChild(child, options.input);
}

async function runPackagedCli(
  host: "codex" | "claude",
  args: readonly string[],
  options: { readonly cwd: string; readonly env: NodeJS.ProcessEnv; readonly input?: string },
): Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }> {
  const script = path.join(
    repositoryRoot,
    "dist",
    "plugins",
    host,
    "skills",
    "agent-markdown-link",
    "scripts",
    "agent-markdown.mjs",
  );
  const child = spawn(process.execPath, [script, ...args], {
    cwd: options.cwd,
    env: options.env,
    windowsHide: true,
  });
  return collectChild(child, options.input);
}

async function collectChild(
  child: ChildProcessWithoutNullStreams,
  input = "",
): Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }> {
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  child.stdin.end(input);
  const code = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (exitCode) => resolve(exitCode ?? 1));
  });
  return {
    code,
    stdout: Buffer.concat(stdout).toString("utf8"),
    stderr: Buffer.concat(stderr).toString("utf8"),
  };
}

async function sha256(filePath: string): Promise<string> {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

async function snapshotTree(
  directory: string,
  excludedRoot?: string,
): Promise<readonly string[]> {
  const entries: string[] = [];

  async function visit(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (excludedRoot !== undefined && fullPath === excludedRoot) continue;
      const relative = path.relative(directory, fullPath).replaceAll(path.sep, "/");
      if (entry.isDirectory()) {
        entries.push(`directory:${relative}`);
        await visit(fullPath);
      } else if (entry.isFile()) {
        entries.push(`file:${relative}:${await sha256(fullPath)}`);
      }
    }
  }

  await visit(directory);
  return entries.sort();
}

it("runs the complete local context and reviewed-candidate path against a temporary vault", async () => {
  const root = await temporaryRoot();
  const vault = path.join(root, "vault");
  const inbox = path.join(vault, "Inbox");
  const memory = path.join(vault, "Memory");
  const workspace = path.join(root, "workspace");
  const environmentRoot = path.join(root, "environment");
  const configPath = path.join(root, "config.json");
  await mkdir(inbox, { recursive: true });
  await mkdir(memory);
  await mkdir(workspace);
  await mkdir(environmentRoot);
  const firstSource = path.join(memory, "one.md");
  const secondSource = path.join(memory, "two.md");
  await writeFile(
    firstSource,
    "First curated source. The verified lighthouse decision is current.",
    "utf8",
  );
  await writeFile(secondSource, "Second curated source. This is an unrelated decoy.", "utf8");
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        vaultRoot: vault,
        inboxPath: "Inbox",
        captureMode: "explicit",
        writeMode: "inbox",
        projects: [
          {
            projectId: "project-a",
            workspaceRoots: [workspace],
            contextFiles: ["Memory/one.md", "Memory/two.md"],
            searchRoots: ["Memory"],
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  const environment = {
    ...process.env,
    APPDATA: environmentRoot,
    LOCALAPPDATA: environmentRoot,
    XDG_CONFIG_HOME: environmentRoot,
    XDG_STATE_HOME: environmentRoot,
  };
  const hashesBefore = [await sha256(firstSource), await sha256(secondSource)];
  const outsideBefore = await snapshotTree(root, vault);

  const context = await runCli(["--config", configPath, "context"], {
    cwd: workspace,
    env: environment,
  });
  expect(context.code, context.stderr).toBe(0);
  expect(context.stderr).toBe("");
  expect(context.stdout.indexOf("First curated source.")).toBeLessThan(
    context.stdout.indexOf("Second curated source."),
  );
  expect(context.stdout).not.toContain(root);

  const searchSnapshot = await snapshotTree(root);
  const searchRequest = JSON.stringify({
    schemaVersion: 1,
    query: "verified lighthouse decision",
  });
  const searchTargets = [
    {
      name: "workspace CLI",
      run: () =>
        runCli(["--config", configPath, "search"], {
          cwd: workspace,
          env: environment,
          input: searchRequest,
        }),
    },
    {
      name: "Codex helper",
      run: () =>
        runPackagedCli("codex", ["--config", configPath, "search"], {
          cwd: workspace,
          env: environment,
          input: searchRequest,
        }),
    },
    {
      name: "Claude helper",
      run: () =>
        runPackagedCli("claude", ["--config", configPath, "search"], {
          cwd: workspace,
          env: environment,
          input: searchRequest,
        }),
    },
  ] as const;

  for (const target of searchTargets) {
    const search = await target.run();
    expect(search.code, `${target.name}: ${search.stderr}`).toBe(0);
    expect(search.stderr, target.name).toBe("");
    expect(Buffer.byteLength(search.stdout, "utf8"), target.name).toBeLessThanOrEqual(16 * 1_024);
    expect(search.stdout, target.name).not.toContain(root);
    const result = JSON.parse(search.stdout) as {
      readonly searchedFiles: number;
      readonly truncated: boolean;
      readonly results: readonly { readonly relativePath: string; readonly snippet: string }[];
    };
    expect(result, target.name).toMatchObject({ searchedFiles: 2, truncated: false });
    expect(result.results[0]?.relativePath, target.name).toBe("Memory/one.md");
    expect(result.results[0]?.snippet, target.name).toContain("verified lighthouse decision");
    expect(await snapshotTree(root), `${target.name} mutated the fixture`).toEqual(searchSnapshot);
  }

  const capture = await runCli(["--config", configPath, "capture"], {
    cwd: workspace,
    env: environment,
    input: JSON.stringify({
      schemaVersion: 1,
      sourceHost: "codex",
      kind: "preference",
      title: "Keep reviews explicit",
      proposedKnowledge: "Agents submit candidates for human review.",
    }),
  });
  expect(capture.code).toBe(0);
  expect(capture.stderr).toBe("");
  const result = JSON.parse(capture.stdout) as { readonly relativePath: string };
  expect(result.relativePath.startsWith("Inbox/")).toBe(true);
  expect(capture.stdout).not.toContain(root);

  const promptCanary = "PRIVATE_PROMPT_CANARY";
  const credential = "Authorization: Bearer abcdefgh";
  const rejected = await runCli(["--config", configPath, "capture"], {
    cwd: workspace,
    env: environment,
    input: JSON.stringify({
      schemaVersion: 1,
      sourceHost: "claude",
      kind: "fact",
      title: promptCanary,
      proposedKnowledge: credential,
    }),
  });
  expect(rejected.code).toBe(2);
  expect(JSON.parse(rejected.stderr)).toEqual({
    code: "E_SECRET_FOUND",
    message: "Candidate contains a possible credential.",
  });
  expect(rejected.stderr).not.toContain(promptCanary);
  expect(rejected.stderr).not.toContain(credential);
  expect(rejected.stderr).not.toContain(root);

  expect([await sha256(firstSource), await sha256(secondSource)]).toEqual(hashesBefore);
  expect((await readdir(inbox)).length).toBe(1);
  expect((await stat(path.join(vault, ...result.relativePath.split("/")))).isFile()).toBe(true);
  expect(await snapshotTree(root, vault)).toEqual(outsideBefore);
});
