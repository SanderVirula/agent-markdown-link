import { posix, win32 } from "node:path";
import { parseArgs } from "node:util";

import {
  AgentMarkdownError,
  SEARCH_REQUEST_BYTES,
  assembleContext,
  captureCandidate,
  loadConfig,
  parseCandidateRequest,
  parseSearchRequest,
  resolveConfigPath,
  searchMarkdown,
  selectProject,
  toSanitizedDiagnostic,
  type StableErrorCode,
} from "@agent-markdown-link/core";

import { readJsonInput, writeText } from "./io.js";
import { initializeConfig } from "./init.js";

const HELP = `Usage:
  agent-markdown [--config <absolute-path>] context
  agent-markdown [--config <absolute-path>] search
  agent-markdown [--config <absolute-path>] capture
  agent-markdown [--config <absolute-path>] init
  agent-markdown --help
`;

const INPUT_ERROR_CODES = new Set<StableErrorCode>([
  "E_INPUT_INVALID",
  "E_CAPTURE_DISABLED",
  "E_SIZE_LIMIT",
  "E_SECRET_FOUND",
]);

export interface CliIo {
  readonly stdin: NodeJS.ReadableStream;
  readonly stdout: NodeJS.WritableStream;
  readonly stderr: NodeJS.WritableStream;
}

function invalidInput(): never {
  throw new AgentMarkdownError("E_INPUT_INVALID");
}

function isAbsoluteLocalPath(value: string): boolean {
  if (value.startsWith("\\\\") || value.startsWith("//")) return false;
  return posix.isAbsolute(value) || (win32.isAbsolute(value) && /^[A-Za-z]:[\\/]/u.test(value));
}

function parseArguments(argv: readonly string[]) {
  try {
    return parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: {
        config: { type: "string" },
        help: { type: "boolean" },
      },
    });
  } catch (error) {
    throw new AgentMarkdownError("E_INPUT_INVALID", { cause: error });
  }
}

function parseCli(argv: readonly string[]): {
  readonly command: "context" | "search" | "capture" | "init" | "help";
  readonly configPath?: string;
} {
  const parsed = parseArguments(argv);
  if (parsed.values.help === true) return { command: "help" };
  if (parsed.positionals.length !== 1) invalidInput();
  const command = parsed.positionals[0];
  if (
    command !== "context" &&
    command !== "search" &&
    command !== "capture" &&
    command !== "init"
  ) {
    invalidInput();
  }
  const configPath = parsed.values.config;
  if (configPath !== undefined && !isAbsoluteLocalPath(configPath)) invalidInput();
  return { command, ...(configPath === undefined ? {} : { configPath }) };
}

export async function main(
  argv: readonly string[],
  io: CliIo,
  environment: { readonly cwd?: string; readonly env?: NodeJS.ProcessEnv } = {},
): Promise<number> {
  try {
    const parsed = parseCli(argv);
    if (parsed.command === "help") {
      await writeText(io.stdout, HELP);
      return 0;
    }

    if (parsed.command === "init") {
      const configPath = resolveConfigPath({
        ...(parsed.configPath === undefined ? {} : { cliPath: parsed.configPath }),
        ...(environment.env === undefined ? {} : { env: environment.env }),
      });
      await initializeConfig({
        configPath,
        cwd: environment.cwd ?? process.cwd(),
        io,
      });
      return 0;
    }

    const config = await loadConfig({
      ...(parsed.configPath === undefined ? {} : { cliPath: parsed.configPath }),
      ...(environment.env === undefined ? {} : { env: environment.env }),
    });
    const project = await selectProject(config, environment.cwd ?? process.cwd());
    if (project === undefined) invalidInput();

    if (parsed.command === "context") {
      await writeText(io.stdout, await assembleContext(config, project));
    } else if (parsed.command === "search") {
      const request = parseSearchRequest(await readJsonInput(io.stdin, SEARCH_REQUEST_BYTES));
      const result = await searchMarkdown(config, project, request);
      await writeText(io.stdout, `${JSON.stringify(result)}\n`);
    } else {
      const request = parseCandidateRequest(await readJsonInput(io.stdin, config.limits.candidateBytes));
      const result = await captureCandidate(config, project, request);
      await writeText(io.stdout, `${JSON.stringify(result)}\n`);
    }
    return 0;
  } catch (error) {
    const diagnostic = toSanitizedDiagnostic(error);
    try {
      await writeText(io.stderr, `${JSON.stringify(diagnostic)}\n`);
    } catch {
      return 1;
    }
    return INPUT_ERROR_CODES.has(diagnostic.code) ? 2 : 1;
  }
}
