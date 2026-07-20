import {
  AgentMarkdownError,
  assembleContext,
  isAbsoluteLocalPath,
  loadConfig,
  selectProject,
  toSanitizedDiagnostic,
} from "@agent-markdown-link/core";

import { readJsonInput, writeText } from "./io.js";
import type { CliIo } from "./main.js";

const CONTEXT_BYTES = 9_000;
const STDOUT_BYTES = 32_768;
const UNAVAILABLE =
  "Agent Markdown Link curated context is unavailable for this session. Continue without assuming memory was loaded.";
const SOURCES = new Set(["startup", "resume", "clear", "compact"]);

interface SessionStartInput {
  readonly cwd: string;
}

function invalidInput(): never {
  throw new AgentMarkdownError("E_INPUT_INVALID");
}

function parseSessionStartInput(value: unknown): SessionStartInput {
  if (typeof value !== "object" || value === null) invalidInput();
  const record = value as Readonly<Record<string, unknown>>;
  if (record.hook_event_name !== "SessionStart") invalidInput();
  if (typeof record.source !== "string" || !SOURCES.has(record.source)) invalidInput();
  if (typeof record.cwd !== "string" || !isAbsoluteLocalPath(record.cwd)) invalidInput();
  return { cwd: record.cwd };
}

function serializeContext(context: string): string {
  if (Buffer.byteLength(context, "utf8") > CONTEXT_BYTES) {
    throw new AgentMarkdownError("E_OUTPUT_LIMIT");
  }
  const text = `${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: context,
    },
  })}\n`;
  if (Buffer.byteLength(text, "utf8") > STDOUT_BYTES) {
    throw new AgentMarkdownError("E_OUTPUT_LIMIT");
  }
  return text;
}

async function reportFailure(error: unknown, io: CliIo): Promise<void> {
  const diagnostic = toSanitizedDiagnostic(error);
  try {
    await writeText(io.stdout, serializeContext(UNAVAILABLE));
  } catch {
    // The hook must still allow the host session to start.
  }
  try {
    await writeText(io.stderr, `${JSON.stringify(diagnostic)}\n`);
  } catch {
    // The hook must still allow the host session to start.
  }
}

export async function sessionStartMain(
  io: CliIo,
  environment: { readonly env?: NodeJS.ProcessEnv } = {},
): Promise<number> {
  try {
    const config = await loadConfig(environment.env === undefined ? {} : { env: environment.env });
    const input = parseSessionStartInput(
      await readJsonInput(io.stdin, config.limits.hookInputBytes),
    );
    const project = await selectProject(config, input.cwd);
    if (project === undefined) return 0;

    const boundedConfig = {
      ...config,
      limits: {
        ...config.limits,
        hookOutputBytes: Math.min(config.limits.hookOutputBytes, CONTEXT_BYTES),
      },
    };
    const context = await assembleContext(boundedConfig, project);
    await writeText(io.stdout, serializeContext(context));
  } catch (error) {
    await reportFailure(error, io);
  }
  return 0;
}
