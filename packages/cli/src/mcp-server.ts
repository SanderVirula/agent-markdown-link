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
const CANDIDATE_KINDS = [
  "decision",
  "fact",
  "preference",
  "project-update",
  "procedure",
  "other",
] as const;

interface McpEnvironment {
  readonly env: NodeJS.ProcessEnv;
}

function text(textValue: string) {
  return { content: [{ type: "text" as const, text: textValue }] };
}

function errorResult(error: unknown) {
  return { ...text(JSON.stringify(toSanitizedDiagnostic(error))), isError: true };
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
): Promise<{ readonly config: ResolvedConfig; readonly project: ResolvedProject }> {
  const config = await loadConfig({ env: environment.env });
  const workspaceRoot = environment.env.CLAUDE_PROJECT_DIR;
  const mappedProject =
    workspaceRoot !== undefined && isAbsoluteLocalPath(workspaceRoot)
      ? await selectProject(config, workspaceRoot)
      : undefined;
  if (mappedProject !== undefined) return { config, project: mappedProject };

  const defaultProject = config.projects.find(
    (project) => project.projectId === config.defaultProjectId,
  );
  const defaultWorkspaceRoot = defaultProject?.workspaceRoots[0];
  if (defaultProject === undefined || defaultWorkspaceRoot === undefined) {
    throw new AgentMarkdownError("E_PROJECT_UNMAPPED");
  }

  const project: ResolvedProject = {
    ...defaultProject,
    workspaceRoot: defaultWorkspaceRoot,
    limits: { ...config.limits, ...defaultProject.limits },
  };
  return { config, project };
}

export function createMcpServer(
  environment: McpEnvironment = { env: process.env },
): McpServer {
  const server = new McpServer({ name: "agent-markdown-link", version: "0.4.1" });

  server.registerTool(
    "context",
    {
      description: "Read curated Markdown context for the configured local project.",
      inputSchema: z.object({}).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        const { config, project } = await configuredProject(environment);
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
        return text(context);
      } catch (error) {
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
        const { config, project } = await configuredProject(environment);
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
      description:
        "Store bounded durable Markdown memory locally; legacy Inbox configurations create a review candidate.",
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
        const { config, project } = await configuredProject(environment);
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
