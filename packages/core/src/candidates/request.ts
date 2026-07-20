import { AgentMarkdownError } from "../errors.js";

export interface CandidateRequestV1 {
  readonly schemaVersion: 1;
  readonly sourceHost: "codex" | "claude";
  readonly kind: "decision" | "fact" | "preference" | "project-update" | "procedure" | "other";
  readonly title: string;
  readonly proposedKnowledge: string;
  readonly rationale?: string;
  readonly evidence?: string;
}

const ALLOWED_FIELDS = new Set([
  "schemaVersion",
  "sourceHost",
  "kind",
  "title",
  "proposedKnowledge",
  "rationale",
  "evidence",
]);
const SOURCE_HOSTS = new Set(["codex", "claude"]);
const KINDS = new Set(["decision", "fact", "preference", "project-update", "procedure", "other"]);

type CredentialRule = "private-key" | "bearer-token" | "github-token";

function invalidInput(): never {
  throw new AgentMarkdownError("E_INPUT_INVALID");
}

function hasLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 1 >= value.length) return true;
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function hasDisallowedControl(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if ((code <= 0x1f && code !== 0x09 && code !== 0x0a) || (code >= 0x7f && code <= 0x9f)) {
      return true;
    }
  }
  return false;
}

function normalizedText(value: unknown): string {
  if (typeof value !== "string") invalidInput();
  const normalized = value.replace(/\r\n?/gu, "\n").trim();
  if (normalized.length === 0 || hasLoneSurrogate(normalized) || hasDisallowedControl(normalized)) {
    invalidInput();
  }
  return normalized;
}

function credentialRule(value: string): CredentialRule | undefined {
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u.test(value)) return "private-key";
  if (/authorization:\s*bearer\s+\S{8,}/iu.test(value)) return "bearer-token";
  if (/ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{20,}/u.test(value)) return "github-token";
  return undefined;
}

export function parseCandidateRequest(value: unknown): CandidateRequestV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalidInput();
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).some((key) => !ALLOWED_FIELDS.has(key))) invalidInput();
  if (candidate.schemaVersion !== 1) invalidInput();
  if (typeof candidate.sourceHost !== "string" || !SOURCE_HOSTS.has(candidate.sourceHost)) {
    invalidInput();
  }
  if (typeof candidate.kind !== "string" || !KINDS.has(candidate.kind)) invalidInput();

  const title = normalizedText(candidate.title);
  if (title.includes("\t") || title.includes("\n") || Array.from(title).length > 200) invalidInput();
  const proposedKnowledge = normalizedText(candidate.proposedKnowledge);
  const rationale = Object.hasOwn(candidate, "rationale")
    ? normalizedText(candidate.rationale)
    : undefined;
  const evidence = Object.hasOwn(candidate, "evidence")
    ? normalizedText(candidate.evidence)
    : undefined;

  if ([title, proposedKnowledge, rationale, evidence].some((text) => text !== undefined && credentialRule(text))) {
    throw new AgentMarkdownError("E_SECRET_FOUND");
  }

  return {
    schemaVersion: 1,
    sourceHost: candidate.sourceHost as CandidateRequestV1["sourceHost"],
    kind: candidate.kind as CandidateRequestV1["kind"],
    title,
    proposedKnowledge,
    ...(rationale === undefined ? {} : { rationale }),
    ...(evidence === undefined ? {} : { evidence }),
  };
}
