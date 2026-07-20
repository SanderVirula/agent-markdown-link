import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const temporaryRoots: string[] = [];
const unavailable =
  "Agent Markdown Link curated context is unavailable for this session. Continue without assuming memory was loaded.";

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function runNode(
  script: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly env: NodeJS.ProcessEnv; readonly input: string },
): Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }> {
  const child = spawn(process.execPath, [script, ...args], {
    cwd: options.cwd,
    env: options.env,
    windowsHide: true,
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  child.stdin.end(options.input);
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

function contextFrom(stdout: string): string {
  const result = JSON.parse(stdout) as {
    readonly hookSpecificOutput: { readonly additionalContext: string };
  };
  return result.hookSpecificOutput.additionalContext;
}

async function hash(filePath: string): Promise<string> {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

describe.each(["codex", "claude"] as const)("relocated %s plugin", (host) => {
  it("loads curated context and creates only a review candidate", async () => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), "agent-markdown-plugin-")));
    temporaryRoots.push(root);
    const pluginRoot = path.join(root, "relocated plugin ü", host);
    await mkdir(path.dirname(pluginRoot), { recursive: true });
    await cp(path.join(repositoryRoot, "dist", "plugins", host), pluginRoot, { recursive: true });

    const vault = path.join(root, "vault");
    const memory = path.join(vault, "Memory");
    const inbox = path.join(vault, "Inbox");
    const workspace = path.join(root, "workspace");
    const environmentRoot = path.join(root, "environment");
    await mkdir(memory, { recursive: true });
    await mkdir(inbox);
    await mkdir(workspace);
    await mkdir(environmentRoot);

    const firstSource = path.join(memory, "First.md");
    const secondSource = path.join(memory, "Second.md");
    await writeFile(firstSource, "First curated artifact fact.", "utf8");
    await writeFile(secondSource, "Second curated artifact fact.", "utf8");

    const baseConfig = {
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
          projectId: "plugin-test",
          workspaceRoots: [workspace],
          contextFiles: ["Memory/First.md", "Memory/Second.md"],
        },
      ],
    };
    const configPath = path.join(root, "config.json");
    await writeFile(configPath, `${JSON.stringify(baseConfig)}\n`, "utf8");

    const environment = {
      ...process.env,
      AGENT_MARKDOWN_LINK_CONFIG: configPath,
      APPDATA: environmentRoot,
      LOCALAPPDATA: environmentRoot,
      XDG_CONFIG_HOME: environmentRoot,
      XDG_STATE_HOME: environmentRoot,
    };
    const runtime = path.join(pluginRoot, "runtime", "session-start.mjs");
    const helper = path.join(
      pluginRoot,
      "skills",
      "agent-markdown-link",
      "scripts",
      "agent-markdown.mjs",
    );
    const hookInput = JSON.stringify({
      hook_event_name: "SessionStart",
      source: "startup",
      cwd: workspace,
    });
    const hashesBefore = [await hash(firstSource), await hash(secondSource)];

    const hook = await runNode(runtime, [], { cwd: workspace, env: environment, input: hookInput });
    expect(hook.code, hook.stderr).toBe(0);
    expect(hook.stderr).toBe("");
    const context = contextFrom(hook.stdout);
    expect(context.indexOf("First curated artifact fact.")).toBeLessThan(
      context.indexOf("Second curated artifact fact."),
    );
    expect(await readdir(inbox)).toEqual([]);

    const capture = await runNode(helper, ["capture"], {
      cwd: workspace,
      env: environment,
      input: JSON.stringify({
        schemaVersion: 1,
        sourceHost: host,
        kind: "decision",
        title: "Keep canonical notes reviewed",
        proposedKnowledge: "Agents submit memory candidates for human review.",
      }),
    });
    expect(capture.code, capture.stderr).toBe(0);
    expect(capture.stderr).toBe("");
    expect(await readdir(inbox)).toHaveLength(1);
    expect([await hash(firstSource), await hash(secondSource)]).toEqual(hashesBefore);

    const missingConfigPath = path.join(root, "missing-config.json");
    await writeFile(
      missingConfigPath,
      `${JSON.stringify({
        ...baseConfig,
        projects: [{ ...baseConfig.projects[0], contextFiles: ["Memory/First.md", "Memory/Missing.md"] }],
      })}\n`,
      "utf8",
    );
    const missing = await runNode(runtime, [], {
      cwd: workspace,
      env: { ...environment, AGENT_MARKDOWN_LINK_CONFIG: missingConfigPath },
      input: hookInput,
    });
    expect(missing.code).toBe(0);
    expect(contextFrom(missing.stdout)).toBe(unavailable);
    expect(`${missing.stdout}${missing.stderr}`).not.toContain("First curated artifact fact.");
    expect(`${missing.stdout}${missing.stderr}`).not.toContain(root);

    const oversized = await runNode(runtime, [], {
      cwd: workspace,
      env: environment,
      input: JSON.stringify({
        hook_event_name: "SessionStart",
        source: "startup",
        cwd: workspace,
        ignored: "HOOK_INPUT_CANARY".repeat(300),
      }),
    });
    expect(oversized.code).toBe(0);
    expect(contextFrom(oversized.stdout)).toBe(unavailable);
    expect(`${oversized.stdout}${oversized.stderr}`).not.toContain("HOOK_INPUT_CANARY");
    expect(`${oversized.stdout}${oversized.stderr}`).not.toContain(root);
    expect([await hash(firstSource), await hash(secondSource)]).toEqual(hashesBefore);
  });
});
