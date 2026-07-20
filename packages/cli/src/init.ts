import { access, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { Transform } from "node:stream";

import {
  AgentMarkdownError,
  resolveExistingDirectory,
  validateConfig,
} from "@agent-markdown-link/core";

import { writeText } from "./io.js";

const INIT_INPUT_BYTES = 64 * 1_024;

interface InitIo {
  readonly stdin: NodeJS.ReadableStream;
  readonly stdout: NodeJS.WritableStream;
}

function invalidInput(): never {
  throw new AgentMarkdownError("E_INPUT_INVALID");
}

function systemErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const code = (error as { readonly code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

async function assertDestinationMissing(configPath: string): Promise<void> {
  try {
    await access(configPath);
  } catch (error) {
    if (systemErrorCode(error) === "ENOENT") return;
    throw error;
  }
  throw new AgentMarkdownError("E_ALREADY_EXISTS");
}

function boundedInput(stream: NodeJS.ReadableStream): Transform {
  let total = 0;
  const bounded = new Transform({
    transform(chunk: Buffer | string, encoding, callback) {
      const bytes = Buffer.isBuffer(chunk) ? chunk.byteLength : Buffer.byteLength(chunk, encoding);
      total += bytes;
      if (total > INIT_INPUT_BYTES) {
        callback(new AgentMarkdownError("E_SIZE_LIMIT"));
        return;
      }
      callback(null, chunk);
    },
  });
  stream.pipe(bounded);
  return bounded;
}

async function ask(
  lines: AsyncIterator<string>,
  stdout: NodeJS.WritableStream,
  prompt: string,
  defaultValue?: string,
): Promise<string> {
  await writeText(stdout, prompt);
  const answer = await lines.next();
  if (answer.done === true) invalidInput();
  const value = answer.value.trim();
  if (value.length > 0) return value;
  if (defaultValue !== undefined) return defaultValue;
  invalidInput();
}

function list(value: string): readonly string[] {
  if (value.length === 0) return [];
  const items = value.split(",").map((item) => item.trim());
  if (items.some((item) => item.length === 0)) invalidInput();
  return items;
}

function projectIdFrom(workspaceRoot: string): string {
  const candidate = path
    .basename(workspaceRoot)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^[._-]+/u, "")
    .slice(0, 64);
  return candidate.length === 0 ? "default" : candidate;
}

function confirmation(value: string): boolean {
  if (value === "" || /^n(?:o)?$/iu.test(value)) return false;
  if (/^y(?:es)?$/iu.test(value)) return true;
  invalidInput();
}

function captureDestination(value: string): "memory" | "inbox" {
  if (value === "memory") return "memory";
  if (value === "inbox") return "inbox";
  invalidInput();
}

async function assertDirectory(directory: string): Promise<void> {
  try {
    if ((await stat(directory)).isDirectory()) return;
  } catch {
    // All filesystem details are reduced to the fixed input diagnostic below.
  }
  invalidInput();
}

export async function initializeConfig(options: {
  readonly configPath: string;
  readonly cwd: string;
  readonly io: InitIo;
}): Promise<void> {
  await assertDestinationMissing(options.configPath);

  const input = boundedInput(options.io.stdin);
  const interface_ = createInterface({ input, terminal: false });
  const lines = interface_[Symbol.asyncIterator]();

  try {
    const vaultRoot = await ask(lines, options.io.stdout, "Vault root (absolute path): ");
    const workspaceRoot = await ask(
      lines,
      options.io.stdout,
      `Workspace root [${options.cwd}]: `,
      options.cwd,
    );
    const suggestedProjectId = projectIdFrom(workspaceRoot);
    const projectId = await ask(
      lines,
      options.io.stdout,
      `Project ID [${suggestedProjectId}]: `,
      suggestedProjectId,
    );
    const contextFiles = list(
      await ask(
        lines,
        options.io.stdout,
        "Context files, comma-separated and vault-relative [none]: ",
        "",
      ),
    );
    const searchRoots = list(
      await ask(
        lines,
        options.io.stdout,
        "Search roots, comma-separated and vault-relative [none]: ",
        "",
      ),
    );
    const destination = captureDestination(
      await ask(
        lines,
        options.io.stdout,
        "Capture destination [memory/inbox] [memory]: ",
        "memory",
      ),
    );
    const selectedPath = await ask(
      lines,
      options.io.stdout,
      destination === "memory"
        ? "Existing automatic memory folder, relative to vault [Memory/Agent Markdown Link]: "
        : "Existing review Inbox, relative to vault [Inbox/Agent Markdown Link]: ",
      destination === "memory" ? "Memory/Agent Markdown Link" : "Inbox/Agent Markdown Link",
    );
    const useAsDefault = confirmation(
      await ask(
        lines,
        options.io.stdout,
        "Use this project for unmapped hosts such as Cowork? [y/N]: ",
        "",
      ),
    );

    const rawConfig = {
      schemaVersion: 1 as const,
      vaultRoot,
      captureMode: "explicit" as const,
      writeMode: destination,
      ...(destination === "memory" ? { memoryPath: selectedPath } : { inboxPath: selectedPath }),
      ...(useAsDefault ? { defaultProjectId: projectId } : {}),
      projects: [
        {
          projectId,
          workspaceRoots: [workspaceRoot],
          contextFiles,
          searchRoots,
        },
      ],
    };

    let validated: ReturnType<typeof validateConfig>;
    try {
      validated = validateConfig(rawConfig);
      await assertDirectory(validated.vaultRoot);
      await assertDirectory(validated.projects[0]!.workspaceRoots[0]!);
      await resolveExistingDirectory(validated.vaultRoot, selectedPath);
    } catch (error) {
      if (error instanceof AgentMarkdownError && error.code === "E_INPUT_INVALID") throw error;
      invalidInput();
    }

    const config = {
      ...rawConfig,
      vaultRoot: validated.vaultRoot,
      projects: [
        {
          ...rawConfig.projects[0],
          workspaceRoots: validated.projects[0]!.workspaceRoots,
        },
      ],
    };

    await mkdir(path.dirname(options.configPath), { recursive: true, mode: 0o700 });
    try {
      await writeFile(options.configPath, `${JSON.stringify(config, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
    } catch (error) {
      if (systemErrorCode(error) === "EEXIST") {
        throw new AgentMarkdownError("E_ALREADY_EXISTS", { cause: error });
      }
      throw error;
    }
    await writeText(
      options.io.stdout,
      `Configuration created.\n${options.configPath}\n` +
        "Agent Markdown Link does not configure Git or sync exclusions; private memory must not be published unintentionally.\n",
    );
  } finally {
    interface_.close();
    options.io.stdin.unpipe(input);
    input.destroy();
  }
}
