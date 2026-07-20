import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ConfigLimits, ResolvedConfig, ResolvedProject } from "../../src/config/types.js";
import {
  SEARCH_MAX_CONCURRENT_READS,
  SEARCH_MAX_DIRECTORY_ENTRIES,
  SEARCH_MAX_FILES,
  SEARCH_MAX_FILE_BYTES,
  SEARCH_MAX_OUTPUT_BYTES,
  SEARCH_MAX_RESULTS,
  SEARCH_MAX_SNIPPET_BYTES,
  SEARCH_MAX_SOURCE_BYTES,
  boundedReadCapacity,
  classifyFileBudget,
  collectSortedEntries,
  safeConcurrentReadWidth,
  searchMarkdown,
  settleOrderedWindow,
  type SearchResponseV1,
} from "../../src/search/search.js";

import {
  SEARCH_QUERY_BYTES,
  SEARCH_REQUEST_BYTES,
  SEARCH_TERM_COUNT,
  parseSearchRequest,
} from "../../src/search/request.js";

const DEFAULT_LIMITS: ConfigLimits = {
  hookInputBytes: 1_048_576,
  hookOutputBytes: 262_144,
  contextFileBytes: 65_536,
  contextTotalBytes: 131_072,
  candidateBytes: 65_536,
  subprocessOutputBytes: 262_144,
  subprocessTimeoutMs: 10_000,
};

const temporaryRoots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "agent-markdown-search-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function fixture(
  root: string,
  searchRoots: readonly string[],
): { readonly config: ResolvedConfig; readonly project: ResolvedProject } {
  const workspaceRoot = path.join(root, "workspace");
  const project = {
    projectId: "project-a",
    workspaceRoots: [workspaceRoot],
    workspaceRoot,
    contextFiles: [],
    searchRoots: [...searchRoots],
    contextExclusions: [],
    limits: DEFAULT_LIMITS,
  } satisfies ResolvedProject;
  const config = {
    schemaVersion: 1,
    vaultRoot: path.join(root, "vault"),
    inboxPath: "Inbox/Agent Markdown Link",
    captureMode: "explicit",
    writeMode: "inbox",
    hookPolicy: "observe",
    limits: DEFAULT_LIMITS,
    contextExclusions: [],
    projects: [project],
    obsidian: { executable: "obsidian" },
    logging: { maxBytes: 1_048_576, maxFiles: 3 },
    metrics: { enabled: false },
    configPath: path.join(root, "config.json"),
    stateRoot: path.join(root, "state"),
    outboxRoot: path.join(root, "outbox"),
  } satisfies ResolvedConfig;
  return { config, project };
}

async function createVault(root: string): Promise<string> {
  const vault = path.join(root, "vault");
  await mkdir(vault);
  return vault;
}

async function writeNote(vault: string, relativePath: string, body: string): Promise<void> {
  const target = path.join(vault, ...relativePath.split("/"));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, body, "utf8");
}

function expectCode(action: () => unknown, code: string): void {
  expect(action).toThrowError(expect.objectContaining({ code }));
}

describe("search request", () => {
  it("parses one strict trimmed query", () => {
    expect(parseSearchRequest({ schemaVersion: 1, query: "  reviewed workflow  " })).toEqual({
      schemaVersion: 1,
      query: "reviewed workflow",
    });
    expect(SEARCH_REQUEST_BYTES).toBe(2_048);
    expect(SEARCH_QUERY_BYTES).toBe(1_024);
    expect(SEARCH_TERM_COUNT).toBe(32);
  });

  it.each([
    ["non-object", null],
    ["array", []],
    ["wrong version", { schemaVersion: 2, query: "valid query" }],
    ["missing query", { schemaVersion: 1 }],
    ["non-string query", { schemaVersion: 1, query: 42 }],
    ["unknown field", { schemaVersion: 1, query: "valid query", extra: true }],
    ["empty query", { schemaVersion: 1, query: "  " }],
    ["one scalar", { schemaVersion: 1, query: "a" }],
    ["line break", { schemaVersion: 1, query: "line\nbreak" }],
    ["tab", { schemaVersion: 1, query: "a\tb" }],
    ["control", { schemaVersion: 1, query: "a\u0000b" }],
    ["lone surrogate", { schemaVersion: 1, query: "ab\ud800" }],
  ])("rejects malformed input: %s", (_name, value) => {
    expectCode(() => parseSearchRequest(value), "E_INPUT_INVALID");
  });

  it("enforces the UTF-8 query byte ceiling with a stable size code", () => {
    expect(parseSearchRequest({ schemaVersion: 1, query: "a".repeat(1_024) }).query).toHaveLength(
      1_024,
    );
    expectCode(
      () => parseSearchRequest({ schemaVersion: 1, query: "a".repeat(1_025) }),
      "E_SIZE_LIMIT",
    );
  });

  it("accepts thirty-two distinct terms and rejects a thirty-third", () => {
    const terms = Array.from({ length: 33 }, (_value, index) => `term${index}`);
    expect(parseSearchRequest({ schemaVersion: 1, query: terms.slice(0, 32).join(" ") })).toEqual({
      schemaVersion: 1,
      query: terms.slice(0, 32).join(" "),
    });
    expectCode(
      () => parseSearchRequest({ schemaVersion: 1, query: terms.join(" ") }),
      "E_SIZE_LIMIT",
    );
  });
});

describe("Markdown search", () => {
  it("returns an empty complete result when no roots are configured", async () => {
    const root = await temporaryRoot();
    await createVault(root);
    const { config, project } = fixture(root, []);

    await expect(
      searchMarkdown(config, project, { schemaVersion: 1, query: "reviewed workflow" }),
    ).resolves.toEqual({ schemaVersion: 1, searchedFiles: 0, truncated: false, results: [] });
  });

  it("ranks a complete phrase above partial terms and ignores non-Markdown files", async () => {
    const root = await temporaryRoot();
    const vault = await createVault(root);
    await writeNote(vault, "Memory/a-partial.md", "A reviewed item with other wording.");
    await writeNote(vault, "Memory/b-exact.MD", "The reviewed workflow is canonical.");
    await writeNote(vault, "Memory/ignored.txt", "reviewed workflow");
    const { config, project } = fixture(root, ["Memory"]);

    const result = await searchMarkdown(config, project, {
      schemaVersion: 1,
      query: "reviewed workflow",
    });

    expect(result).toMatchObject({ schemaVersion: 1, searchedFiles: 2, truncated: false });
    expect(result.results.map((entry) => entry.relativePath)).toEqual([
      "Memory/b-exact.MD",
      "Memory/a-partial.md",
    ]);
    expect(result.results[0]?.snippet).toContain("reviewed workflow");
    expect(JSON.stringify(result)).not.toContain(root);
    expect(result.results.every((entry) => !entry.relativePath.includes("\\"))).toBe(true);
  });

  it("uses coverage, occurrences, position, and path for stable ranking", async () => {
    const root = await temporaryRoot();
    const vault = await createVault(root);
    await writeNote(vault, "Memory/e.md", "alpha only");
    await writeNote(vault, "Memory/d.md", "zzz alpha x omega");
    await writeNote(vault, "Memory/b.md", "alpha x omega");
    await writeNote(vault, "Memory/a.md", "alpha x omega");
    await writeNote(vault, "Memory/c.md", "alpha alpha omega");
    const { config, project } = fixture(root, ["Memory"]);

    const result = await searchMarkdown(config, project, {
      schemaVersion: 1,
      query: "alpha omega",
    });

    expect(result.results.map((entry) => entry.relativePath)).toEqual([
      "Memory/c.md",
      "Memory/a.md",
      "Memory/b.md",
      "Memory/d.md",
      "Memory/e.md",
    ]);
  });

  it("deduplicates overlapping roots and never follows a discovered link", async () => {
    const root = await temporaryRoot();
    const vault = await createVault(root);
    const outside = await temporaryRoot();
    await writeNote(vault, "Memory/Sub/inside.md", "durable needle");
    await writeFile(path.join(outside, "outside.md"), "durable needle", "utf8");
    await symlink(
      outside,
      path.join(vault, "Memory", "escape"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const { config, project } = fixture(root, ["Memory", "Memory/Sub"]);

    const result = await searchMarkdown(config, project, {
      schemaVersion: 1,
      query: "durable needle",
    });

    expect(result.searchedFiles).toBe(1);
    expect(result.results.map((entry) => entry.relativePath)).toEqual(["Memory/Sub/inside.md"]);
  });

  it("enforces the fixed entry and file budgets without configuration", async () => {
    expect(SEARCH_MAX_DIRECTORY_ENTRIES).toBe(50_000);
    expect(SEARCH_MAX_FILES).toBe(10_000);
    expect(SEARCH_MAX_SOURCE_BYTES).toBe(32 * 1_024 * 1_024);
    expect(SEARCH_MAX_FILE_BYTES).toBe(64 * 1_024);
    expect(SEARCH_MAX_RESULTS).toBe(8);
    expect(SEARCH_MAX_SNIPPET_BYTES).toBe(1_024);
    expect(SEARCH_MAX_OUTPUT_BYTES).toBe(16 * 1_024);

    expect(classifyFileBudget(0, 0, SEARCH_MAX_FILE_BYTES)).toBe("search");
    expect(classifyFileBudget(0, 0, SEARCH_MAX_FILE_BYTES + 1)).toBe("skip");
    expect(classifyFileBudget(SEARCH_MAX_FILES, 0, 1)).toBe("stop");
    expect(classifyFileBudget(0, SEARCH_MAX_SOURCE_BYTES, 1)).toBe("stop");
  });

  it("calculates a fixed safe concurrent read width from worst-case capacity", () => {
    expect(SEARCH_MAX_CONCURRENT_READS).toBe(16);
    expect(safeConcurrentReadWidth(0, 0)).toBe(16);
    expect(safeConcurrentReadWidth(SEARCH_MAX_FILES - 3, 0)).toBe(3);
    expect(
      safeConcurrentReadWidth(0, SEARCH_MAX_SOURCE_BYTES - 2 * SEARCH_MAX_FILE_BYTES),
    ).toBe(2);
    expect(
      safeConcurrentReadWidth(0, SEARCH_MAX_SOURCE_BYTES - SEARCH_MAX_FILE_BYTES + 1),
    ).toBe(0);
    expect(safeConcurrentReadWidth(0, SEARCH_MAX_SOURCE_BYTES)).toBe(0);
  });

  it("right-sizes a bounded read and reserves one byte for growth", () => {
    expect(boundedReadCapacity(0)).toBe(1);
    expect(boundedReadCapacity(123)).toBe(124);
    expect(boundedReadCapacity(SEARCH_MAX_FILE_BYTES)).toBe(SEARCH_MAX_FILE_BYTES + 1);
  });

  it("starts sixteen jobs together and settles every outcome in input order", async () => {
    let started = 0;
    let settled = 0;
    const controls = Array.from({ length: SEARCH_MAX_CONCURRENT_READS }, (_value, index) => {
      let resolve!: (value: number) => void;
      let reject!: (reason: Error) => void;
      const promise = new Promise<number>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
      }).finally(() => {
        settled += 1;
      });
      return { index, promise, reject, resolve };
    });
    const rejection = new Error("ordered rejection");

    const outcomesPromise = settleOrderedWindow(
      controls.map((control) => () => {
        started += 1;
        return control.promise;
      }),
    );

    expect(started).toBe(SEARCH_MAX_CONCURRENT_READS);
    for (const control of [...controls].reverse()) {
      if (control.index === 3) control.reject(rejection);
      else control.resolve(control.index);
    }

    await expect(outcomesPromise).resolves.toEqual(
      controls.map((control) =>
        control.index === 3
          ? { status: "rejected", reason: rejection }
          : { status: "fulfilled", value: control.index },
      ),
    );
    expect(settled).toBe(SEARCH_MAX_CONCURRENT_READS);
  });

  it("rejects an oversized internal window before starting any job", async () => {
    let started = 0;
    const jobs = Array.from({ length: SEARCH_MAX_CONCURRENT_READS + 1 }, () => () => {
      started += 1;
      return Promise.resolve();
    });

    const outcomesPromise = settleOrderedWindow(jobs);

    expect(started).toBe(0);
    await expect(outcomesPromise).rejects.toMatchObject({
      code: "E_INTERNAL",
      message: "Internal operation failed.",
    });
  });

  it("collects a complete directory in ordinal order or no partial batch", async () => {
    const root = await temporaryRoot();
    const directory = path.join(root, "entries");
    await mkdir(directory);
    await writeFile(path.join(directory, "c.md"), "c", "utf8");
    await writeFile(path.join(directory, "a.md"), "a", "utf8");
    await writeFile(path.join(directory, "b.md"), "b", "utf8");

    await expect(collectSortedEntries(directory, 2)).resolves.toEqual({
      entries: [],
      truncated: true,
    });
    const complete = await collectSortedEntries(directory, 3);
    expect(complete.truncated).toBe(false);
    expect(complete.entries.map((entry) => entry.name)).toEqual(["a.md", "b.md", "c.md"]);
  });

  it("skips an oversized note, marks truncation, and continues deterministically", async () => {
    const root = await temporaryRoot();
    const vault = await createVault(root);
    await writeNote(vault, "Memory/a-large.md", "x".repeat(SEARCH_MAX_FILE_BYTES + 1));
    await writeNote(vault, "Memory/b-small.md", "durable needle");
    const { config, project } = fixture(root, ["Memory"]);

    const result = await searchMarkdown(config, project, {
      schemaVersion: 1,
      query: "durable needle",
    });

    expect(result).toMatchObject({ searchedFiles: 1, truncated: true });
    expect(result.results.map((entry) => entry.relativePath)).toEqual(["Memory/b-small.md"]);
  });

  it("returns the same exact response for tied windows created in opposite orders", async () => {
    const relativePaths = Array.from(
      { length: 10 },
      (_value, index) => `Memory/note-${index}.md`,
    );
    const fixtures = [];
    for (const creationOrder of [relativePaths, [...relativePaths].reverse()]) {
      const root = await temporaryRoot();
      const vault = await createVault(root);
      await writeNote(vault, "Memory/00-oversized.md", "x".repeat(SEARCH_MAX_FILE_BYTES + 1));
      for (const relativePath of creationOrder) {
        await writeNote(vault, relativePath, "durable needle");
      }
      fixtures.push(fixture(root, ["Memory"]));
    }
    const expected = {
      schemaVersion: 1,
      searchedFiles: 10,
      truncated: true,
      results: relativePaths.slice(0, SEARCH_MAX_RESULTS).map((relativePath) => ({
        relativePath,
        snippet: "durable needle",
      })),
    } satisfies SearchResponseV1;

    for (const { config, project } of fixtures) {
      await expect(
        searchMarkdown(config, project, { schemaVersion: 1, query: "durable needle" }),
      ).resolves.toEqual(expected);
      await expect(
        searchMarkdown(config, project, { schemaVersion: 1, query: "durable needle" }),
      ).resolves.toEqual(expected);
    }
  });

  it("returns only the best eight without treating lower-ranked matches as truncation", async () => {
    const root = await temporaryRoot();
    const vault = await createVault(root);
    for (let index = 0; index < 9; index += 1) {
      await writeNote(vault, `Memory/note-${index}.md`, "durable needle");
    }
    const { config, project } = fixture(root, ["Memory"]);

    const result = await searchMarkdown(config, project, {
      schemaVersion: 1,
      query: "durable needle",
    });

    expect(result.searchedFiles).toBe(9);
    expect(result.truncated).toBe(false);
    expect(result.results).toHaveLength(8);
    expect(result.results.map((entry) => entry.relativePath)).toEqual(
      Array.from({ length: 8 }, (_value, index) => `Memory/note-${index}.md`),
    );
  });

  it("caps occurrence ranking before the path tie-breaker", async () => {
    const root = await temporaryRoot();
    const vault = await createVault(root);
    await writeNote(vault, "Memory/z-more.md", `${"alpha ".repeat(33)}end`);
    await writeNote(vault, "Memory/a-cap.md", `${"alpha ".repeat(32)}end`);
    const { config, project } = fixture(root, ["Memory"]);

    const result = await searchMarkdown(config, project, { schemaVersion: 1, query: "alpha" });

    expect(result.results.map((entry) => entry.relativePath)).toEqual([
      "Memory/a-cap.md",
      "Memory/z-more.md",
    ]);
  });

  it("centers a valid UTF-8 snippet within its source-byte limit", async () => {
    const root = await temporaryRoot();
    const vault = await createVault(root);
    await writeNote(
      vault,
      "Memory/unicode.md",
      `${"😀".repeat(400)}durable needle${"😀".repeat(400)}`,
    );
    const { config, project } = fixture(root, ["Memory"]);

    const result = await searchMarkdown(config, project, {
      schemaVersion: 1,
      query: "durable needle",
    });
    const snippet = result.results[0]?.snippet ?? "";

    expect(snippet).toContain("durable needle");
    expect(snippet).not.toContain("�");
    expect(Buffer.byteLength(snippet, "utf8")).toBeLessThanOrEqual(SEARCH_MAX_SNIPPET_BYTES);
  });

  it("drops lowest-ranked results until serialized JSON fits the output limit", async () => {
    const root = await temporaryRoot();
    const vault = await createVault(root);
    for (let index = 0; index < 8; index += 1) {
      await writeNote(
        vault,
        `Memory/nul-${index}.md`,
        `${"\u0000".repeat(700)}durable needle${"\u0000".repeat(700)}`,
      );
    }
    const { config, project } = fixture(root, ["Memory"]);

    const result = await searchMarkdown(config, project, {
      schemaVersion: 1,
      query: "durable needle",
    });

    expect(result.truncated).toBe(true);
    expect(result.results.length).toBeLessThan(8);
    expect(Buffer.byteLength(JSON.stringify(result), "utf8")).toBeLessThanOrEqual(
      SEARCH_MAX_OUTPUT_BYTES,
    );
  });

  it("returns only a sanitized operational diagnostic for invalid note UTF-8", async () => {
    const root = await temporaryRoot();
    const vault = await createVault(root);
    await mkdir(path.join(vault, "Memory"));
    await writeFile(path.join(vault, "Memory", "PRIVATE_PATH_CANARY.md"), Buffer.from([0xc3, 0x28]));
    const { config, project } = fixture(root, ["Memory"]);

    await expect(
      searchMarkdown(config, project, { schemaVersion: 1, query: "durable needle" }),
    ).rejects.toMatchObject({ code: "E_INTERNAL", message: "Internal operation failed." });
  });
});
