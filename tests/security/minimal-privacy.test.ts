import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { parseCandidateRequest } from "../../packages/core/src/candidates/request.js";
import { toSanitizedDiagnostic } from "../../packages/core/src/errors.js";
import { resolveExistingFile } from "../../packages/core/src/fs/safe-path.js";
import { searchMarkdown } from "../../packages/core/src/search/search.js";
import type { ResolvedConfig, ResolvedProject } from "../../packages/core/src/config/types.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("does not put search query, note, or path content into diagnostics", async () => {
  const canary = "PRIVATE_SEARCH_CANARY";
  const temporary = await mkdtemp(path.join(tmpdir(), "agent-markdown-search-privacy-"));
  temporaryRoots.push(temporary);
  const vault = path.join(temporary, `vault-${canary}`);
  const memory = path.join(vault, "Memory");
  await mkdir(memory, { recursive: true });
  await writeFile(path.join(memory, `${canary}.md`), Buffer.from([0xc3, 0x28]));

  const limits = {
    hookInputBytes: 1_048_576,
    hookOutputBytes: 262_144,
    contextFileBytes: 65_536,
    contextTotalBytes: 131_072,
    candidateBytes: 65_536,
    subprocessOutputBytes: 262_144,
    subprocessTimeoutMs: 10_000,
  };
  const project = {
    projectId: "project-a",
    workspaceRoots: [temporary],
    workspaceRoot: temporary,
    contextFiles: [],
    searchRoots: ["Memory"],
    contextExclusions: [],
    limits,
  } satisfies ResolvedProject;
  const config = {
    schemaVersion: 1,
    vaultRoot: vault,
    inboxPath: "Inbox",
    captureMode: "explicit",
    writeMode: "inbox",
    hookPolicy: "observe",
    limits,
    contextExclusions: [],
    projects: [project],
    obsidian: { executable: "obsidian" },
    logging: { maxBytes: 1_048_576, maxFiles: 3 },
    metrics: { enabled: false },
    configPath: path.join(temporary, "config.json"),
    stateRoot: path.join(temporary, "state"),
    outboxRoot: path.join(temporary, "outbox"),
  } satisfies ResolvedConfig;

  let failure: unknown;
  try {
    await searchMarkdown(config, project, { schemaVersion: 1, query: canary });
  } catch (error) {
    failure = error;
  }
  const diagnostic = toSanitizedDiagnostic(failure);
  expect(diagnostic).toEqual({ code: "E_INTERNAL", message: "Internal operation failed." });
  expect(JSON.stringify(diagnostic)).not.toContain(canary);
});

it("returns only fixed diagnostics for malformed content and path escape", async () => {
  const canary = "PRIVATE_DIAGNOSTIC_CANARY";
  let malformed: unknown;
  try {
    parseCandidateRequest({
      schemaVersion: 1,
      sourceHost: "codex",
      kind: "fact",
      title: "Fact",
      proposedKnowledge: "Knowledge",
      unexpected: canary,
    });
  } catch (error) {
    malformed = error;
  }
  expect(toSanitizedDiagnostic(malformed)).toEqual({
    code: "E_INPUT_INVALID",
    message: "Input is invalid.",
  });

  const temporary = await mkdtemp(path.join(tmpdir(), "agent-markdown-privacy-"));
  temporaryRoots.push(temporary);
  const vault = path.join(temporary, `vault-${canary}`);
  const outside = path.join(temporary, "outside");
  await mkdir(vault);
  await mkdir(outside);
  await writeFile(path.join(outside, "note.md"), canary, "utf8");
  await symlink(outside, path.join(vault, "escape"), process.platform === "win32" ? "junction" : "dir");
  let escaped: unknown;
  try {
    await resolveExistingFile(vault, "escape/note.md");
  } catch (error) {
    escaped = error;
  }
  const diagnostic = toSanitizedDiagnostic(escaped);
  expect(diagnostic).toEqual({
    code: "E_PATH_ESCAPE",
    message: "Path escapes its configured root.",
  });
  expect(Object.keys(diagnostic)).toEqual(["code", "message"]);
  expect(JSON.stringify({ malformed: toSanitizedDiagnostic(malformed), escaped: diagnostic })).not.toContain(
    canary,
  );
});
