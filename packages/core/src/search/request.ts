import { AgentMarkdownError } from "../errors.js";

export const SEARCH_REQUEST_BYTES = 2_048;
export const SEARCH_QUERY_BYTES = 1_024;
export const SEARCH_TERM_COUNT = 32;

export interface SearchRequestV1 {
  readonly schemaVersion: 1;
  readonly query: string;
}

const ALLOWED_FIELDS = new Set(["schemaVersion", "query"]);
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/u;
const TERM = /[\p{L}\p{N}]+/gu;

function invalidInput(): never {
  throw new AgentMarkdownError("E_INPUT_INVALID");
}

function sizeLimit(): never {
  throw new AgentMarkdownError("E_SIZE_LIMIT");
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

export function extractSearchTerms(query: string): readonly string[] {
  const terms = new Set<string>();
  for (const match of query.toLowerCase().matchAll(TERM)) {
    const term = match[0];
    if (Array.from(term).length >= 2) terms.add(term);
  }
  return [...terms];
}

export function parseSearchRequest(value: unknown): SearchRequestV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalidInput();
  const request = value as Record<string, unknown>;
  if (Object.keys(request).some((key) => !ALLOWED_FIELDS.has(key))) invalidInput();
  if (request.schemaVersion !== 1 || typeof request.query !== "string") invalidInput();
  if (CONTROL_CHARACTER.test(request.query) || hasLoneSurrogate(request.query)) invalidInput();

  const query = request.query.trim();
  const nonWhitespaceScalars = Array.from(query).filter((character) => !/\s/u.test(character));
  if (nonWhitespaceScalars.length < 2) invalidInput();
  if (Buffer.byteLength(query, "utf8") > SEARCH_QUERY_BYTES) sizeLimit();
  if (extractSearchTerms(query).length > SEARCH_TERM_COUNT) sizeLimit();

  return { schemaVersion: 1, query };
}
