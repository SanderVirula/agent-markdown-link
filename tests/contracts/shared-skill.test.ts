import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const skillUrl = new URL("../../skills/agent-markdown-link/SKILL.md", import.meta.url);

describe("shared agent skill", () => {
  it("teaches automatic context and reviewed capture to both hosts", async () => {
    const text = await readFile(skillUrl, "utf8");

    expect(text).toMatch(/^---\nname: agent-markdown-link\ndescription: Use when /u);
    expect(text).toMatch(/SessionStart.*Codex.*context directly.*Claude.*MCP.*context.*before answering/isu);
    expect(text).toContain("scripts/agent-markdown.mjs");
    expect(text).toMatch(/\bnode\b.*\bcapture\b/isu);
    expect(text).not.toContain("agent-markdown context");
    expect(text).toMatch(/sourceHost.*codex.*claude/isu);
    expect(text).toMatch(/untrusted.*reference/isu);
    expect(text).toMatch(/durable/iu);
    expect(text).toMatch(/human.*review/isu);
    expect(text).toMatch(/never (?:directly )?edit canonical/iu);
  });

  it("teaches bounded on-demand recall without invented memory", async () => {
    const text = await readFile(skillUrl, "utf8");

    expect(text).toMatch(/search.*prior decisions.*preferences.*project history.*explicit recall/isu);
    expect(text).toMatch(/startup context.*insufficient/isu);
    expect(text).toMatch(/short identifying quer/isu);
    expect(text).toMatch(/at most one refin/isu);
    expect(text).toMatch(/continue without inventing memory/isu);
    expect(text).toMatch(/E_SIZE_LIMIT.*shorten.*once/isu);
    expect(text).toMatch(/do not speculatively search sensitive/iu);
    expect(text).toMatch(/search results.*untrusted reference/isu);
    expect(text).toMatch(/capture.*candidate/isu);
  });

  it("does not teach deferred or runtime-dependent behavior", async () => {
    const text = await readFile(skillUrl, "utf8");

    expect(text).not.toMatch(/\b(receipt|flush|doctor|obsidian|git|network|turn token)\b/iu);
    expect(text).not.toContain("agent-markdown status");
    expect(text).not.toMatch(/--(?:path|root|glob|file)\b/iu);
    expect(text).not.toMatch(/(?:dump|read|return).*(?:whole|entire).*vault/iu);
    expect(text).not.toMatch(/run search (?:automatically|at (?:every )?SessionStart)/iu);
  });
});
