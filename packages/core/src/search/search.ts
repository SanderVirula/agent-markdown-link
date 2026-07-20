import type { Dirent } from "node:fs";
import { open, opendir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";

import type { ResolvedConfig, ResolvedProject } from "../config/types.js";
import { AgentMarkdownError } from "../errors.js";
import { resolveExistingDirectory, validatePortableRelativePath } from "../fs/safe-path.js";
import { extractSearchTerms, type SearchRequestV1 } from "./request.js";

export const SEARCH_MAX_DIRECTORY_ENTRIES = 50_000;
export const SEARCH_MAX_FILES = 10_000;
export const SEARCH_MAX_SOURCE_BYTES = 32 * 1_024 * 1_024;
export const SEARCH_MAX_FILE_BYTES = 64 * 1_024;
export const SEARCH_MAX_CONCURRENT_READS = 16;
export const SEARCH_MAX_RESULTS = 8;
export const SEARCH_MAX_SNIPPET_BYTES = 1_024;
export const SEARCH_MAX_OUTPUT_BYTES = 16 * 1_024;

const SEARCH_MAX_OCCURRENCES_PER_TERM = 32;

export interface SearchResponseV1 {
  readonly schemaVersion: 1;
  readonly searchedFiles: number;
  readonly truncated: boolean;
  readonly results: readonly {
    readonly relativePath: string;
    readonly snippet: string;
  }[];
}

interface RankedMatch {
  readonly relativePath: string;
  readonly content: string;
  readonly phraseMatch: boolean;
  readonly matchedTerms: number;
  readonly occurrences: number;
  readonly firstMatch: number;
  readonly snippetStart: number;
  readonly snippetLength: number;
}

interface DirectoryEntries {
  readonly entries: readonly Dirent[];
  readonly truncated: boolean;
}

interface InspectedFile {
  readonly canonicalFile: string;
  readonly relativePath: string;
  readonly fileBytes: number;
}

interface PreparedFile extends InspectedFile {
  readonly bytes: Uint8Array | undefined;
}

function compareOrdinal(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareMatches(left: RankedMatch, right: RankedMatch): number {
  if (left.phraseMatch !== right.phraseMatch) return left.phraseMatch ? -1 : 1;
  if (left.matchedTerms !== right.matchedTerms) return right.matchedTerms - left.matchedTerms;
  if (left.occurrences !== right.occurrences) return right.occurrences - left.occurrences;
  if (left.firstMatch !== right.firstMatch) return left.firstMatch - right.firstMatch;
  return compareOrdinal(left.relativePath, right.relativePath);
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function literalExpression(value: string, global = false): RegExp {
  return new RegExp(escapeRegularExpression(value), global ? "giu" : "iu");
}

function rankContent(
  relativePath: string,
  content: string,
  request: SearchRequestV1,
): RankedMatch | undefined {
  const phrase = literalExpression(request.query).exec(content);
  let matchedTerms = 0;
  let occurrences = 0;
  let firstMatch = phrase?.index ?? Number.MAX_SAFE_INTEGER;
  let snippetStart = phrase?.index ?? Number.MAX_SAFE_INTEGER;
  let snippetLength = phrase?.[0].length ?? 0;

  for (const term of extractSearchTerms(request.query)) {
    const expression = literalExpression(term, true);
    let termOccurrences = 0;
    for (const match of content.matchAll(expression)) {
      termOccurrences += 1;
      firstMatch = Math.min(firstMatch, match.index);
      if (phrase === null && match.index < snippetStart) {
        snippetStart = match.index;
        snippetLength = match[0].length;
      }
      if (termOccurrences === SEARCH_MAX_OCCURRENCES_PER_TERM) break;
    }
    if (termOccurrences > 0) {
      matchedTerms += 1;
      occurrences += termOccurrences;
    }
  }

  if (phrase === null && matchedTerms === 0) return undefined;
  return {
    relativePath,
    content,
    phraseMatch: phrase !== null,
    matchedTerms,
    occurrences,
    firstMatch,
    snippetStart,
    snippetLength,
  };
}

export function classifyFileBudget(
  searchedFiles: number,
  sourceBytes: number,
  fileBytes: number,
): "search" | "skip" | "stop" {
  if (searchedFiles >= SEARCH_MAX_FILES) return "stop";
  if (fileBytes > SEARCH_MAX_FILE_BYTES) return "skip";
  if (sourceBytes + fileBytes > SEARCH_MAX_SOURCE_BYTES) return "stop";
  return "search";
}

export function boundedReadCapacity(expectedFileBytes: number): number {
  return Math.min(expectedFileBytes, SEARCH_MAX_FILE_BYTES) + 1;
}

export function safeConcurrentReadWidth(searchedFiles: number, sourceBytes: number): number {
  const remainingFileSlots = SEARCH_MAX_FILES - searchedFiles;
  const remainingSourceSlots = Math.floor(
    (SEARCH_MAX_SOURCE_BYTES - sourceBytes) / SEARCH_MAX_FILE_BYTES,
  );
  return Math.max(
    0,
    Math.min(SEARCH_MAX_CONCURRENT_READS, remainingFileSlots, remainingSourceSlots),
  );
}

export async function settleOrderedWindow<T>(
  jobs: readonly (() => Promise<T>)[],
): Promise<readonly PromiseSettledResult<T>[]> {
  if (jobs.length > SEARCH_MAX_CONCURRENT_READS) throw new AgentMarkdownError("E_INTERNAL");
  const started = jobs.map((job) => {
    try {
      return job();
    } catch (error) {
      return Promise.reject(error);
    }
  });
  return Promise.allSettled(started);
}

export async function collectSortedEntries(
  directory: string,
  remainingEntries: number,
): Promise<DirectoryEntries> {
  const handle = await opendir(directory);
  const entries: Dirent[] = [];
  try {
    for (;;) {
      const entry = await handle.read();
      if (entry === null) {
        entries.sort((left, right) => compareOrdinal(left.name, right.name));
        return { entries, truncated: false };
      }
      if (entries.length === remainingEntries) return { entries: [], truncated: true };
      entries.push(entry);
    }
  } finally {
    await handle.close();
  }
}

function containedRelativePath(canonicalRoot: string, canonicalFile: string): string {
  const relativePath = path.relative(canonicalRoot, canonicalFile);
  if (
    relativePath.length === 0 ||
    path.isAbsolute(relativePath) ||
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`)
  ) {
    throw new AgentMarkdownError("E_PATH_ESCAPE");
  }
  return validatePortableRelativePath(relativePath.split(path.sep).join("/"));
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new AgentMarkdownError("E_INTERNAL", { cause: error });
  }
}

async function readBoundedFile(
  filePath: string,
  expectedFileBytes: number,
): Promise<Uint8Array | undefined> {
  const handle = await open(filePath, "r");
  const buffer = Buffer.allocUnsafe(boundedReadCapacity(expectedFileBytes));
  let offset = 0;
  try {
    while (offset < buffer.byteLength) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.byteLength - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
  } finally {
    await handle.close();
  }
  if (offset > expectedFileBytes || offset > SEARCH_MAX_FILE_BYTES) return undefined;
  return buffer.subarray(0, offset);
}

async function inspectFile(canonicalRoot: string, discovered: string): Promise<InspectedFile> {
  const canonicalFile = await realpath(discovered);
  const relativePath = containedRelativePath(canonicalRoot, canonicalFile);
  const fileStatus = await stat(canonicalFile);
  if (!fileStatus.isFile()) throw new AgentMarkdownError("E_PATH_UNSAFE");
  return { canonicalFile, relativePath, fileBytes: fileStatus.size };
}

async function prepareFile(canonicalRoot: string, discovered: string): Promise<PreparedFile> {
  const inspected = await inspectFile(canonicalRoot, discovered);
  const bytes =
    inspected.fileBytes > SEARCH_MAX_FILE_BYTES
      ? undefined
      : await readBoundedFile(inspected.canonicalFile, inspected.fileBytes);
  return { ...inspected, bytes };
}

function addBestMatch(matches: RankedMatch[], match: RankedMatch): void {
  matches.push(match);
  matches.sort(compareMatches);
  if (matches.length > SEARCH_MAX_RESULTS) matches.pop();
}

function utf8Prefix(value: readonly string[], maxBytes: number): string {
  const result: string[] = [];
  let bytes = 0;
  for (const scalar of value) {
    const scalarBytes = Buffer.byteLength(scalar, "utf8");
    if (bytes + scalarBytes > maxBytes) break;
    result.push(scalar);
    bytes += scalarBytes;
  }
  return result.join("");
}

function makeSnippet(content: string, start: number, length: number): string {
  const before = Array.from(content.slice(0, start));
  const matched = Array.from(content.slice(start, start + length));
  const after = Array.from(content.slice(start + length));
  const matchedText = utf8Prefix(matched, SEARCH_MAX_SNIPPET_BYTES);
  let remaining = SEARCH_MAX_SNIPPET_BYTES - Buffer.byteLength(matchedText, "utf8");
  if (matchedText !== matched.join("") || remaining === 0) return matchedText;

  const left: string[] = [];
  const right: string[] = [];
  let leftIndex = before.length - 1;
  let rightIndex = 0;
  let leftBlocked = false;
  let rightBlocked = false;

  while (remaining > 0 && (!leftBlocked || !rightBlocked)) {
    if (!leftBlocked) {
      if (leftIndex < 0) {
        leftBlocked = true;
      } else {
        const scalar = before[leftIndex] ?? "";
        const bytes = Buffer.byteLength(scalar, "utf8");
        if (bytes > remaining) {
          leftBlocked = true;
        } else {
          left.push(scalar);
          leftIndex -= 1;
          remaining -= bytes;
        }
      }
    }
    if (!rightBlocked) {
      if (rightIndex >= after.length) {
        rightBlocked = true;
      } else {
        const scalar = after[rightIndex] ?? "";
        const bytes = Buffer.byteLength(scalar, "utf8");
        if (bytes > remaining) {
          rightBlocked = true;
        } else {
          right.push(scalar);
          rightIndex += 1;
          remaining -= bytes;
        }
      }
    }
  }

  return `${left.reverse().join("")}${matchedText}${right.join("")}`;
}

function serializedOutputBytes(response: SearchResponseV1): number {
  return Buffer.byteLength(`${JSON.stringify(response)}\n`, "utf8");
}

export async function searchMarkdown(
  config: ResolvedConfig,
  project: ResolvedProject,
  request: SearchRequestV1,
): Promise<SearchResponseV1> {
  if (project.searchRoots.length === 0) {
    return { schemaVersion: 1, searchedFiles: 0, truncated: false, results: [] };
  }

  const canonicalVaultRoot = await realpath(config.vaultRoot);
  if (!(await stat(canonicalVaultRoot)).isDirectory()) {
    throw new AgentMarkdownError("E_PATH_UNSAFE");
  }

  const seenDirectories = new Set<string>();
  const seenFiles = new Set<string>();
  const matches: RankedMatch[] = [];
  let entriesVisited = 0;
  let searchedFiles = 0;
  let sourceBytes = 0;
  let truncated = false;
  let stopped = false;

  function beginFile(inspected: InspectedFile): boolean {
    if (seenFiles.has(inspected.canonicalFile)) return false;
    seenFiles.add(inspected.canonicalFile);

    const initialBudget = classifyFileBudget(
      searchedFiles,
      sourceBytes,
      inspected.fileBytes,
    );
    if (initialBudget === "stop") {
      truncated = true;
      stopped = true;
      return false;
    }
    if (initialBudget === "skip") {
      truncated = true;
      return false;
    }
    return true;
  }

  function finishFile(inspected: InspectedFile, bytes: Uint8Array | undefined): void {
    if (bytes === undefined) {
      truncated = true;
      return;
    }
    const actualBudget = classifyFileBudget(searchedFiles, sourceBytes, bytes.byteLength);
    if (actualBudget === "stop") {
      truncated = true;
      stopped = true;
      return;
    }
    if (actualBudget === "skip") {
      truncated = true;
      return;
    }

    const content = decodeUtf8(bytes);
    searchedFiles += 1;
    sourceBytes += bytes.byteLength;
    const match = rankContent(inspected.relativePath, content, request);
    if (match !== undefined) addBestMatch(matches, match);
  }

  async function processSequentialFile(discovered: string): Promise<void> {
    const inspected = await inspectFile(canonicalVaultRoot, discovered);
    if (!beginFile(inspected)) return;
    finishFile(
      inspected,
      await readBoundedFile(inspected.canonicalFile, inspected.fileBytes),
    );
  }

  async function walk(directory: string): Promise<void> {
    if (stopped || seenDirectories.has(directory)) return;
    seenDirectories.add(directory);

    const batch = await collectSortedEntries(
      directory,
      SEARCH_MAX_DIRECTORY_ENTRIES - entriesVisited,
    );
    if (batch.truncated) {
      truncated = true;
      stopped = true;
      return;
    }
    entriesVisited += batch.entries.length;

    const pendingFiles: string[] = [];

    async function flushPendingFiles(): Promise<void> {
      const discoveredFiles = pendingFiles.splice(0);
      let nextFile = 0;
      while (!stopped && nextFile < discoveredFiles.length) {
        const width = safeConcurrentReadWidth(searchedFiles, sourceBytes);
        if (width === 0) {
          if (
            searchedFiles >= SEARCH_MAX_FILES ||
            sourceBytes >= SEARCH_MAX_SOURCE_BYTES
          ) {
            truncated = true;
            stopped = true;
            return;
          }
          const discovered = discoveredFiles[nextFile];
          if (discovered === undefined) throw new AgentMarkdownError("E_INTERNAL");
          nextFile += 1;
          await processSequentialFile(discovered);
          continue;
        }

        const window = discoveredFiles.slice(nextFile, nextFile + width);
        nextFile += window.length;
        const outcomes = await settleOrderedWindow(
          window.map((discovered) => () => prepareFile(canonicalVaultRoot, discovered)),
        );
        for (const outcome of outcomes) {
          if (stopped) return;
          if (outcome.status === "rejected") throw outcome.reason;
          if (!beginFile(outcome.value)) continue;
          finishFile(outcome.value, outcome.value.bytes);
        }
      }
    }

    for (const entry of batch.entries) {
      if (stopped) return;
      if (entry.isSymbolicLink()) {
        await flushPendingFiles();
        continue;
      }
      const discovered = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await flushPendingFiles();
        await walk(discovered);
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        pendingFiles.push(discovered);
        continue;
      }
      await flushPendingFiles();
    }
    await flushPendingFiles();
  }

  for (const searchRoot of project.searchRoots) {
    if (stopped) break;
    await walk(await resolveExistingDirectory(canonicalVaultRoot, searchRoot));
  }

  const results: { relativePath: string; snippet: string }[] = matches.map(
    ({ relativePath, content, snippetStart, snippetLength }) => ({
      relativePath,
      snippet: makeSnippet(content, snippetStart, snippetLength),
    }),
  );
  let response: SearchResponseV1 = { schemaVersion: 1, searchedFiles, truncated, results };
  while (results.length > 0 && serializedOutputBytes(response) > SEARCH_MAX_OUTPUT_BYTES) {
    results.pop();
    truncated = true;
    response = { schemaVersion: 1, searchedFiles, truncated, results };
  }
  return response;
}
