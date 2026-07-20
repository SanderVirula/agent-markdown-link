import { randomUUID } from "node:crypto";

import type { ResolvedConfig, ResolvedProject } from "../config/types.js";
import { AgentMarkdownError } from "../errors.js";
import { ensurePrivateDirectory } from "../fs/safe-path.js";
import { publishNoReplace } from "../fs/publish.js";
import { parseCandidateRequest, type CandidateRequestV1 } from "./request.js";
import { serializeCandidate } from "./serialize.js";

export async function captureCandidate(
  config: ResolvedConfig,
  project: ResolvedProject,
  request: CandidateRequestV1,
  options: { readonly now?: () => Date; readonly randomId?: () => string } = {},
): Promise<{ readonly candidateId: string; readonly projectId: string; readonly relativePath: string }> {
  if (config.captureMode === "disabled") {
    throw new AgentMarkdownError("E_CAPTURE_DISABLED");
  }

  const normalizedRequest = parseCandidateRequest(request);
  const candidateId = (options.randomId ?? randomUUID)();
  const createdAt = (options.now ?? (() => new Date()))().toISOString();
  const timestamp = createdAt.replace(/[-:.]/gu, "");
  const filename = `${timestamp}-${candidateId}.md`;
  const markdown = serializeCandidate(normalizedRequest, {
    id: candidateId,
    createdAt,
    projectId: project.projectId,
  });
  const bytes = Buffer.from(markdown, "utf8");
  if (bytes.byteLength > config.limits.candidateBytes) {
    throw new AgentMarkdownError("E_SIZE_LIMIT");
  }

  let root: string;
  let relativePath: string;
  if (config.writeMode === "inbox") {
    root = config.vaultRoot;
    relativePath = `${config.inboxPath}/${filename}`;
  } else {
    root = config.outboxRoot;
    relativePath = filename;
    await ensurePrivateDirectory(root);
  }

  await publishNoReplace(root, relativePath, bytes);
  return { candidateId, projectId: project.projectId, relativePath };
}
