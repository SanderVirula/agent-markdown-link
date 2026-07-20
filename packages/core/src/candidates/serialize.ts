import type { CandidateRequestV1 } from "./request.js";

export function serializeCandidate(
  request: CandidateRequestV1,
  metadata: { readonly id: string; readonly createdAt: string; readonly projectId: string },
): string {
  const frontmatter = [
    "---",
    "schema: agent-markdown-link/candidate",
    "schemaVersion: 1",
    `id: ${JSON.stringify(metadata.id)}`,
    `createdAt: ${JSON.stringify(metadata.createdAt)}`,
    `projectId: ${JSON.stringify(metadata.projectId)}`,
    `sourceHost: ${request.sourceHost}`,
    `kind: ${request.kind}`,
    "status: candidate",
    `title: ${JSON.stringify(request.title)}`,
    "---",
  ].join("\n");
  const sections = [`## Proposed durable knowledge\n\n${request.proposedKnowledge}`];
  if (request.rationale !== undefined) sections.push(`## Rationale\n\n${request.rationale}`);
  if (request.evidence !== undefined) sections.push(`## Evidence\n\n${request.evidence}`);
  return `${frontmatter}\n\n${sections.join("\n\n")}\n`;
}
