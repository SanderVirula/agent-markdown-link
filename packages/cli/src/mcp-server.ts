import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Transform } from "node:stream";
import {
  AgentMarkdownError,
  assembleContext,
  captureCandidate,
  isAbsoluteLocalPath,
  loadConfig,
  parseCandidateRequest,
  parseSearchRequest,
  searchMarkdown,
  selectProject,
  toSanitizedDiagnostic,
  type ResolvedConfig,
  type ResolvedProject,
} from "@agent-markdown-link/core";
import { z } from "zod";

const CONTEXT_BYTES = 9_000;
const MCP_FRAME_BYTES = 2 * 1_024 * 1_024;
const UNAVAILABLE =
  "Agent Markdown Link curated context is unavailable for this session. Continue without assuming memory was loaded.";
const HOOK_EVENTS = ["SessionStart", "UserPromptSubmit"] as const;
const CANDIDATE_KINDS = [
  "decision",
  "fact",
  "preference",
  "project-update",
  "procedure",
  "other",
] as const;

type HookEventName = (typeof HOOK_EVENTS)[number];

interface McpEnvironment {
  readonly env: NodeJS.ProcessEnv;
}

function text(textValue: string) {
  return { content: [{ type: "text" as const, text: textValue }] };
}

function errorResult(error: unknown) {
  return { ...text(JSON.stringify(toSanitizedDiagnostic(error))), isError: true };
}

function invalidInput(): never {
  throw new AgentMarkdownError("E_INPUT_INVALID");
}

function hookOutput(hookEventName: HookEventName, additionalContext: string): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName,
      additionalContext,
    },
  });
}

function boundedStdin(): Transform {
  let pendingBytes = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      let lineStart = 0;
      for (let index = 0; index < chunk.byteLength; index += 1) {
        if (chunk[index] !== 0x0a) continue;
        pendingBytes += index - lineStart + 1;
        if (pendingBytes > MCP_FRAME_BYTES) {
          callback(new AgentMarkdownError("E_SIZE_LIMIT"));
          return;
        }
        pendingBytes = 0;
        lineStart = index + 1;
      }
      pendingBytes += chunk.byteLength - lineStart;
      if (pendingBytes > MCP_FRAME_BYTES) {
        callback(new AgentMarkdownError("E_SIZE_LIMIT"));
        return;
      }
      callback(null, chunk);
    },
  });
}

async function configuredProject(
  environment: McpEnvironment,
): Promise<{ readonly config: ResolvedConfig; readonly project: ResolvedProject | undefined }> {
  const workspaceRoot = environment.env.CLAUDE_PROJECT_DIR;
  if (workspaceRoot === undefined || !isAbsoluteLocalPath(workspaceRoot)) invalidInput();
  const config = await loadConfig({ env: environment.env });
  const project = await selectProject(config, workspaceRoot);
  return { config, project };
}

async function mappedProject(
  environment: McpEnvironment,
): Promise<{ readonly config: ResolvedConfig; readonly project: ResolvedProject }> {
  const { config, project } = await configuredProject(environment);
  if (project === undefined) invalidInput();
  return { config, project };
}

export function createMcpServer(
  environment: McpEnvironment = { env: process.env },
): McpServer {
  const deliveredSessions = new Set<string>();
  const server = new McpServer({ name: "agent-markdown-link", version: "0.2.1" });

  server.registerTool(
    "context",
    {
      description: "Read curated Markdown context for the configured local project.",
      inputSchema: z
        .object({
          hookEventName: z.enum(HOOK_EVENTS).optional(),
          sessionId: z.string().min(1).max(256).optional(),
        })
        .strict()
        .refine(
          (value) =>
            (value.hookEventName === undefined) === (value.sessionId === undefined),
          "hookEventName and sessionId must be supplied together",
        ),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ hookEventName, sessionId }) => {
      if (sessionId !== undefined && deliveredSessions.has(sessionId)) return text("");

      try {
        const { config, project } = await configuredProject(environment);
        if (project === undefined) {
          if (sessionId !== undefined) deliveredSessions.add(sessionId);
          return text("");
        }
        const context = await assembleContext(
          {
            ...config,
            limits: {
              ...config.limits,
              hookOutputBytes: Math.min(config.limits.hookOutputBytes, CONTEXT_BYTES),
            },
          },
          project,
        );
        if (sessionId !== undefined) deliveredSessions.add(sessionId);
        return text(
          hookEventName === undefined ? context : hookOutput(hookEventName, context),
        );
      } catch (error) {
        if (sessionId !== undefined && hookEventName !== undefined) {
          deliveredSessions.add(sessionId);
          return text(hookOutput(hookEventName, UNAVAILABLE));
        }
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "search",
    {
      description: "Search configured local Markdown and return bounded excerpts.",
      inputSchema: z.object({ query: z.string().min(1).max(1_024) }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ query }) => {
      try {
        const { config, project } = await mappedProject(environment);
        const request = parseSearchRequest({ schemaVersion: 1, query });
        return text(JSON.stringify(await searchMarkdown(config, project, request)));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "capture",
    {
      description: "Submit a bounded Markdown memory candidate for human review.",
      inputSchema: z
        .object({
          kind: z.enum(CANDIDATE_KINDS),
          title: z.string().min(1).max(200),
          proposedKnowledge: z.string().min(1).max(1_048_576),
          rationale: z.string().min(1).max(1_048_576).optional(),
          evidence: z.string().min(1).max(1_048_576).optional(),
        })
        .strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ kind, title, proposedKnowledge, rationale, evidence }) => {
      try {
        const { config, project } = await mappedProject(environment);
        const request = parseCandidateRequest({
          schemaVersion: 1,
          sourceHost: "claude",
          kind,
          title,
          proposedKnowledge,
          ...(rationale === undefined ? {} : { rationale }),
          ...(evidence === undefined ? {} : { evidence }),
        });
        return text(JSON.stringify(await captureCandidate(config, project, request)));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  return server;
}

export async function runMcpServer(): Promise<void> {
  const server = createMcpServer();
  const input = boundedStdin();
  let failed = false;
  input.on("error", (error: unknown) => {
    if (failed) return;
    failed = true;
    try {
      process.stderr.write(`${JSON.stringify(toSanitizedDiagnostic(error))}\n`);
    } catch {
      // The process still terminates without exposing the original error.
    }
    process.exitCode = 1;
    process.stdin.unpipe(input);
    process.stdin.destroy();
    void server.close().catch(() => {
      // Closing is best-effort after rejecting the transport.
    });
  });
  process.stdin.pipe(input);
  await server.connect(new StdioServerTransport(input));
}
