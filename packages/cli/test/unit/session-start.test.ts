import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

import { sessionStartMain } from "../../src/session-start.js";

const temporaryRoots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "agent-markdown-session-start-"));
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

async function runRawHook(
  input: string | Uint8Array,
  env: NodeJS.ProcessEnv,
): Promise<{ readonly exitCode: number; readonly stdout: string; readonly stderr: string }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCode = await sessionStartMain(
    {
      stdin: Readable.from([typeof input === "string" ? Buffer.from(input, "utf8") : input]),
      stdout: collectingStream(stdout),
      stderr: collectingStream(stderr),
    },
    { env },
  );
  return { exitCode, stdout: stdout.join(""), stderr: stderr.join("") };
}

async function runHook(
  input: unknown,
  env: NodeJS.ProcessEnv,
): Promise<{ readonly exitCode: number; readonly stdout: string; readonly stderr: string }> {
  return runRawHook(JSON.stringify(input), env);
}

async function scenario(): Promise<{
  readonly configPath: string;
  readonly firstSource: string;
  readonly root: string;
  readonly vault: string;
  readonly workspace: string;
  readonly secondSource: string;
}> {
  const root = await temporaryRoot();
  const vault = path.join(root, "vault");
  const workspace = path.join(root, "workspace");
  const memory = path.join(vault, "Memory");
  const inbox = path.join(vault, "Inbox");
  const configPath = path.join(root, "config.json");
  await mkdir(workspace);
  await mkdir(memory, { recursive: true });
  await mkdir(inbox);
  const firstSource = path.join(memory, "First.md");
  await writeFile(firstSource, "First curated fact.", "utf8");
  const secondSource = path.join(memory, "Second.md");
  await writeFile(secondSource, "Second curated fact.", "utf8");
  await writeFile(
    configPath,
    `${JSON.stringify({
      schemaVersion: 1,
      vaultRoot: vault,
      inboxPath: "Inbox",
      captureMode: "explicit",
      writeMode: "inbox",
      limits: {
        hookInputBytes: 4096,
        hookOutputBytes: 4096,
        contextFileBytes: 1024,
        contextTotalBytes: 2048,
        candidateBytes: 1024,
      },
      projects: [
        {
          projectId: "project-a",
          workspaceRoots: [workspace],
          contextFiles: ["Memory/First.md", "Memory/Second.md"],
        },
      ],
    })}\n`,
    "utf8",
  );
  return { configPath, firstSource, root, vault, workspace, secondSource };
}

const UNAVAILABLE =
  "Agent Markdown Link curated context is unavailable for this session. Continue without assuming memory was loaded.";

function additionalContext(stdout: string): string {
  const parsed = JSON.parse(stdout) as {
    readonly hookSpecificOutput: { readonly additionalContext: string };
  };
  return parsed.hookSpecificOutput.additionalContext;
}

describe("SessionStart context", () => {
  it("injects configured context in order for a mapped startup", async () => {
    const setup = await scenario();
    const result = await runHook(
      {
        hook_event_name: "SessionStart",
        source: "startup",
        cwd: setup.workspace,
        transcript_path: "TRANSCRIPT_CANARY",
        model: "MODEL_CANARY",
      },
      { AGENT_MARKDOWN_LINK_CONFIG: setup.configPath },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    const parsed = JSON.parse(result.stdout) as {
      readonly hookSpecificOutput: {
        readonly hookEventName: string;
        readonly additionalContext: string;
      };
    };
    expect(parsed.hookSpecificOutput.hookEventName).toBe("SessionStart");
    const context = parsed.hookSpecificOutput.additionalContext;
    expect(context).toContain("Agent Markdown Link curated context follows.");
    expect(context.indexOf("First curated fact.")).toBeLessThan(
      context.indexOf("Second curated fact."),
    );
    expect(result.stdout).not.toContain("TRANSCRIPT_CANARY");
    expect(result.stdout).not.toContain("MODEL_CANARY");
  });

  it.each(["startup", "resume", "clear", "compact"])(
    "accepts the %s SessionStart source",
    async (source) => {
      const setup = await scenario();
      const result = await runHook(
        { hook_event_name: "SessionStart", source, cwd: setup.workspace },
        { AGENT_MARKDOWN_LINK_CONFIG: setup.configPath },
      );

      expect(result.exitCode).toBe(0);
      expect(additionalContext(result.stdout)).toContain("First curated fact.");
    },
  );

  it("is silent for an unmapped working directory", async () => {
    const setup = await scenario();
    const result = await runHook(
      { hook_event_name: "SessionStart", source: "startup", cwd: setup.root },
      { AGENT_MARKDOWN_LINK_CONFIG: setup.configPath },
    );

    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
  });
});

describe("SessionStart failures", () => {
  it.each([
    ["wrong event", { hook_event_name: "Stop", source: "startup" }],
    ["wrong source", { hook_event_name: "SessionStart", source: "manual" }],
    ["relative cwd", { hook_event_name: "SessionStart", source: "startup", cwd: "relative" }],
  ])("fails open with no input canary for %s", async (_name, partial) => {
    const setup = await scenario();
    const result = await runHook(
      { ...partial, cwd: "cwd" in partial ? partial.cwd : setup.workspace, canary: "INPUT_CANARY" },
      { AGENT_MARKDOWN_LINK_CONFIG: setup.configPath },
    );

    expect(result.exitCode).toBe(0);
    expect(additionalContext(result.stdout)).toBe(UNAVAILABLE);
    expect(JSON.parse(result.stderr)).toEqual({ code: "E_INPUT_INVALID", message: "Input is invalid." });
    expect(`${result.stdout}${result.stderr}`).not.toContain("INPUT_CANARY");
  });

  it("fails open for malformed and oversized hook JSON", async () => {
    const setup = await scenario();
    const malformed = await runRawHook("{not json", {
      AGENT_MARKDOWN_LINK_CONFIG: setup.configPath,
    });
    expect(additionalContext(malformed.stdout)).toBe(UNAVAILABLE);
    expect(JSON.parse(malformed.stderr)).toMatchObject({ code: "E_INPUT_INVALID" });

    const oversized = await runRawHook("x".repeat(4097), {
      AGENT_MARKDOWN_LINK_CONFIG: setup.configPath,
    });
    expect(additionalContext(oversized.stdout)).toBe(UNAVAILABLE);
    expect(JSON.parse(oversized.stderr)).toMatchObject({ code: "E_SIZE_LIMIT" });
  });

  it("injects no partial context when a configured file is unavailable", async () => {
    const setup = await scenario();
    await unlink(setup.secondSource);
    const result = await runHook(
      { hook_event_name: "SessionStart", source: "startup", cwd: setup.workspace },
      { AGENT_MARKDOWN_LINK_CONFIG: setup.configPath },
    );

    expect(additionalContext(result.stdout)).toBe(UNAVAILABLE);
    expect(result.stdout).not.toContain("First curated fact.");
    expect(result.stderr).not.toContain(setup.root);
    expect(result.stderr).not.toContain("Second.md");
  });

  it("fails open without leaking an unsafe configured context path", async () => {
    const setup = await scenario();
    const outsideName = "OUTSIDE-PATH-CANARY.md";
    await writeFile(path.join(setup.root, outsideName), "OUTSIDE-CONTENT-CANARY", "utf8");
    const config = JSON.parse(await readFile(setup.configPath, "utf8")) as {
      projects: { contextFiles: string[] }[];
    };
    config.projects[0]!.contextFiles = [`../${outsideName}`];
    await writeFile(setup.configPath, JSON.stringify(config), "utf8");

    const result = await runHook(
      { hook_event_name: "SessionStart", source: "startup", cwd: setup.workspace },
      { AGENT_MARKDOWN_LINK_CONFIG: setup.configPath },
    );

    expect(additionalContext(result.stdout)).toBe(UNAVAILABLE);
    expect(JSON.parse(result.stderr)).toMatchObject({ code: "E_CONFIG_INVALID" });
    expect(`${result.stdout}${result.stderr}`).not.toContain("OUTSIDE-PATH-CANARY");
    expect(`${result.stdout}${result.stderr}`).not.toContain("OUTSIDE-CONTENT-CANARY");
    expect(`${result.stdout}${result.stderr}`).not.toContain(setup.root);
  });

  it("counts the 9,000-byte context ceiling in UTF-8 bytes without truncating", async () => {
    const setup = await scenario();
    const config = JSON.parse(await readFile(setup.configPath, "utf8")) as {
      limits: {
        hookOutputBytes: number;
        contextFileBytes: number;
        contextTotalBytes: number;
      };
      projects: { contextFiles: string[] }[];
    };
    config.limits.hookOutputBytes = 20_000;
    config.limits.contextFileBytes = 10_000;
    config.limits.contextTotalBytes = 10_000;
    config.projects[0]!.contextFiles = ["Memory/First.md"];
    await writeFile(setup.configPath, JSON.stringify(config), "utf8");

    const fittingBody = "é".repeat(4_000);
    await writeFile(setup.firstSource, fittingBody, "utf8");
    const fitting = await runHook(
      { hook_event_name: "SessionStart", source: "startup", cwd: setup.workspace },
      { AGENT_MARKDOWN_LINK_CONFIG: setup.configPath },
    );
    expect(fitting.stderr).toBe("");
    expect(additionalContext(fitting.stdout)).toContain(fittingBody);
    expect(Buffer.byteLength(additionalContext(fitting.stdout), "utf8")).toBeLessThanOrEqual(9_000);

    await writeFile(setup.firstSource, "é".repeat(4_500), "utf8");
    const oversized = await runHook(
      { hook_event_name: "SessionStart", source: "startup", cwd: setup.workspace },
      { AGENT_MARKDOWN_LINK_CONFIG: setup.configPath },
    );
    const oversizedContext = additionalContext(oversized.stdout);
    expect(oversized.stderr).toBe("");
    expect(oversizedContext).toContain('--- omitted sources: 1 ---\n"Memory/First.md" bytes: 9000');
    expect(oversizedContext).not.toContain("é");
    expect(Buffer.byteLength(oversizedContext, "utf8")).toBeLessThanOrEqual(9_000);
  });

  it("injects whole notes and identifies the omitted note for the field-size regression", async () => {
    const setup = await scenario();
    const memory = path.dirname(setup.firstSource);
    const profilePath = path.join(memory, "Profile.md");
    const preferencesPath = path.join(memory, "Preferences.md");
    const decisionsPath = path.join(memory, "Decisions.md");
    const profileBody = `PROFILE_CANARY\n${"p".repeat(550)}`;
    const preferencesBody = `PREFERENCES_CANARY\n${"q".repeat(3_895)}`;
    const decisionsBody = `DECISIONS_CANARY\n${"r".repeat(4_985)}`;
    expect(Buffer.byteLength(profileBody, "utf8")).toBe(565);
    expect(Buffer.byteLength(preferencesBody, "utf8")).toBe(3_914);
    expect(Buffer.byteLength(decisionsBody, "utf8")).toBe(5_002);
    await writeFile(profilePath, profileBody, "utf8");
    await writeFile(preferencesPath, preferencesBody, "utf8");
    await writeFile(decisionsPath, decisionsBody, "utf8");
    const config = JSON.parse(await readFile(setup.configPath, "utf8")) as {
      limits: {
        hookOutputBytes: number;
        contextFileBytes: number;
        contextTotalBytes: number;
      };
      projects: { contextFiles: string[] }[];
    };
    config.limits.hookOutputBytes = 20_000;
    config.limits.contextFileBytes = 10_000;
    config.limits.contextTotalBytes = 20_000;
    config.projects[0]!.contextFiles = [
      "Memory/Profile.md",
      "Memory/Preferences.md",
      "Memory/Decisions.md",
    ];
    await writeFile(setup.configPath, JSON.stringify(config), "utf8");

    const result = await runHook(
      { hook_event_name: "SessionStart", source: "startup", cwd: setup.workspace },
      { AGENT_MARKDOWN_LINK_CONFIG: setup.configPath },
    );

    const context = additionalContext(result.stdout);
    expect(result.stderr).toBe("");
    expect(context).toContain(profileBody);
    expect(context).toContain(preferencesBody);
    expect(context).toContain('--- omitted sources: 1 ---\n"Memory/Decisions.md" bytes: 5002');
    expect(context).not.toContain(decisionsBody);
    expect(Buffer.byteLength(context, "utf8")).toBeLessThanOrEqual(9_000);
  });

  it("fails open when JSON escaping would exceed the serialized stdout cap", async () => {
    const setup = await scenario();
    const config = JSON.parse(await readFile(setup.configPath, "utf8")) as {
      limits: {
        hookOutputBytes: number;
        contextFileBytes: number;
        contextTotalBytes: number;
      };
      projects: { contextFiles: string[] }[];
    };
    config.limits.hookOutputBytes = 20_000;
    config.limits.contextFileBytes = 10_000;
    config.limits.contextTotalBytes = 10_000;
    config.projects[0]!.contextFiles = ["Memory/First.md"];
    await writeFile(setup.configPath, JSON.stringify(config), "utf8");
    await writeFile(setup.firstSource, "\u0000".repeat(6_000), "utf8");

    const result = await runHook(
      { hook_event_name: "SessionStart", source: "startup", cwd: setup.workspace },
      { AGENT_MARKDOWN_LINK_CONFIG: setup.configPath },
    );

    expect(additionalContext(result.stdout)).toBe(UNAVAILABLE);
    expect(Buffer.byteLength(result.stdout, "utf8")).toBeLessThanOrEqual(32_768);
    expect(JSON.parse(result.stderr)).toMatchObject({ code: "E_OUTPUT_LIMIT" });
    expect(result.stdout).not.toContain("\u0000");
  });

  it("uses the fixed notice even when the configured output limit is smaller", async () => {
    const setup = await scenario();
    const config = JSON.parse(await readFile(setup.configPath, "utf8")) as {
      limits: { hookOutputBytes: number };
    };
    config.limits.hookOutputBytes = 1;
    await writeFile(setup.configPath, JSON.stringify(config), "utf8");

    const result = await runHook(
      { hook_event_name: "SessionStart", source: "startup", cwd: setup.workspace },
      { AGENT_MARKDOWN_LINK_CONFIG: setup.configPath },
    );

    expect(additionalContext(result.stdout)).toBe(UNAVAILABLE);
    expect(Buffer.byteLength(result.stdout, "utf8")).toBeLessThanOrEqual(32_768);
    expect(JSON.parse(result.stderr)).toMatchObject({ code: "E_OUTPUT_LIMIT" });
  });

  it("sanitizes a missing configuration without blocking the host", async () => {
    const setup = await scenario();
    const missingConfig = path.join(setup.root, "MISSING-CONFIG-CANARY.json");
    const result = await runHook(
      { hook_event_name: "SessionStart", source: "startup", cwd: setup.workspace },
      { AGENT_MARKDOWN_LINK_CONFIG: missingConfig },
    );

    expect(additionalContext(result.stdout)).toBe(UNAVAILABLE);
    expect(JSON.parse(result.stderr)).toEqual({
      code: "E_CONFIG_INVALID",
      message: "Configuration is invalid.",
    });
    expect(`${result.stdout}${result.stderr}`).not.toContain("MISSING-CONFIG-CANARY");
  });
});
