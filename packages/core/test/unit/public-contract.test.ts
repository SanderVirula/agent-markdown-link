import { describe, expect, it } from "vitest";
import { CORE_SCHEMA_VERSION, type NormalizedHookInvocation } from "../../src/index.js";

describe("core public contract", () => {
  it("exports schema version 1 and the normalized hook shape", () => {
    const invocation: NormalizedHookInvocation = {
      schemaVersion: 1,
      host: "codex",
      event: "SessionStart",
      cwd: "workspace",
      stopHookActive: false,
    };
    expect(CORE_SCHEMA_VERSION).toBe(1);
    expect(invocation.event).toBe("SessionStart");
  });
});
