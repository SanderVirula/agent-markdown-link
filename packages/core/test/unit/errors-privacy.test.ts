import { describe, expect, it } from "vitest";

import { AgentMarkdownError, toSanitizedDiagnostic } from "../../src/errors.js";
import { measureDuration } from "../../src/privacy/clock.js";
import {
  createWhitelistLogger,
  type WhitelistLogEntry,
} from "../../src/privacy/log.js";
import {
  createMetricsRecorder,
  type MetricEvent,
} from "../../src/privacy/metrics.js";
import { redactTurnTokens } from "../../src/privacy/redact.js";

const token = `aml1_${"A".repeat(43)}`;
const canary = `PRIVATE_CANARY_${token}`;

describe("sanitized errors and token redaction", () => {
  it("maps unknown exceptions without leaking paths, tokens, or messages", () => {
    const result = toSanitizedDiagnostic(new Error(`failed C:\\Users\\Example\\vault ${token}`));
    expect(result).toEqual({ code: "E_INTERNAL", message: "Internal operation failed." });
    expect(JSON.stringify(result)).not.toContain("Example");
    expect(JSON.stringify(result)).not.toContain(token);
  });

  it("maps typed errors to fixed messages and ignores their cause", () => {
    const error = new AgentMarkdownError("E_SIZE_LIMIT", { cause: new Error(canary) });
    const diagnostic = toSanitizedDiagnostic(error);
    expect(diagnostic).toEqual({ code: "E_SIZE_LIMIT", message: "Size limit exceeded." });
    expect(JSON.stringify(diagnostic)).not.toContain(canary);
  });

  it.each([
    ["E_INPUT_INVALID", "Input is invalid."],
    ["E_CAPTURE_DISABLED", "Candidate capture is disabled."],
  ] as const)("provides the fixed %s diagnostic", (code, message) => {
    expect(toSanitizedDiagnostic(new AgentMarkdownError(code, { cause: new Error(canary) }))).toEqual({
      code,
      message,
    });
  });

  it("redacts exact standalone turn tokens only", () => {
    expect(redactTurnTokens(`first=${token} second=${token}`)).toBe(
      "first=[REDACTED_TOKEN] second=[REDACTED_TOKEN]",
    );
    expect(redactTurnTokens(`aml1_${"A".repeat(42)}`)).toBe(`aml1_${"A".repeat(42)}`);
    expect(redactTurnTokens(`aml1_${"A".repeat(44)}`)).toBe(`aml1_${"A".repeat(44)}`);
    expect(redactTurnTokens(`x${token}`)).toBe(`x${token}`);
  });
});

describe("monotonic measurement", () => {
  it("uses monotonic nanoseconds for durations", async () => {
    const ticks = [100n, 1_600_100n];
    const result = await measureDuration(() => ticks.shift()!, async () => "ok");
    expect(result).toEqual({ value: "ok", durationNs: 1_600_000n });
  });
});

describe("whitelist logger", () => {
  it("constructs records from allowed fields and drops runtime extras", () => {
    const records: unknown[] = [];
    const logger = createWhitelistLogger({
      now: () => new Date("2026-07-16T00:00:00.000Z"),
      sink: (record) => records.push(record),
    });
    const malicious = {
      kind: "outcome",
      eventCode: "hook.stop",
      outcomeCode: "receipt.missing",
      host: "codex",
      projectId: "project-a",
      byteBucket: "1k-16k",
      countBucket: "2-10",
      durationBucket: "10-99ms",
      errorCode: "E_RECEIPT_EXPIRED",
      prompt: canary,
      path: canary,
      message: canary,
      token: token,
      sessionId: canary,
    } as unknown as WhitelistLogEntry;

    expect(logger.log(malicious)).toBe(true);
    expect(records).toEqual([
      {
        schemaVersion: 1,
        timestamp: "2026-07-16T00:00:00.000Z",
        kind: "outcome",
        eventCode: "hook.stop",
        outcomeCode: "receipt.missing",
        host: "codex",
        projectId: "project-a",
        byteBucket: "1k-16k",
        countBucket: "2-10",
        durationBucket: "10-99ms",
        errorCode: "E_RECEIPT_EXPIRED",
      },
    ]);
    expect(JSON.stringify({ records, status: logger.status() })).not.toContain(canary);
    expect(JSON.stringify({ records, status: logger.status() })).not.toContain(token);
  });

  it("rejects invalid runtime codes without forwarding input", () => {
    const records: unknown[] = [];
    const logger = createWhitelistLogger({ sink: (record) => records.push(record) });
    expect(
      logger.log({ kind: "event", eventCode: canary } as unknown as WhitelistLogEntry),
    ).toBe(false);
    expect(records).toEqual([]);
    expect(logger.status()).toEqual({ accepted: 0, dropped: 1 });
  });

  it("snapshots validated fields and ignores an overridden date serializer", () => {
    const records: unknown[] = [];
    const now = new Date("2026-07-16T00:00:00.000Z");
    Object.defineProperty(now, "toISOString", { value: () => canary });
    let eventCodeReads = 0;
    const changingEntry = {
      kind: "event",
      get eventCode() {
        eventCodeReads += 1;
        return eventCodeReads === 1 ? "hook.start" : canary;
      },
    } as unknown as WhitelistLogEntry;
    const logger = createWhitelistLogger({ now: () => now, sink: (record) => records.push(record) });

    expect(logger.log(changingEntry)).toBe(true);
    expect(records).toEqual([
      {
        schemaVersion: 1,
        timestamp: "2026-07-16T00:00:00.000Z",
        kind: "event",
        eventCode: "hook.start",
      },
    ]);
    expect(JSON.stringify(records)).not.toContain(canary);
  });

  it("forbids content-bearing fields at compile time", () => {
    const logger = createWhitelistLogger({ sink: () => undefined });
    if (false) {
      // @ts-expect-error prompt is never a logger field
      logger.log({ kind: "event", eventCode: "hook.start", prompt: "x" });
      // @ts-expect-error path is never a logger field
      logger.log({ kind: "event", eventCode: "hook.start", path: "x" });
      // @ts-expect-error message is never a logger field
      logger.log({ kind: "event", eventCode: "hook.start", message: "x" });
      // @ts-expect-error token is never a logger field
      logger.log({ kind: "event", eventCode: "hook.start", token: "x" });
      // @ts-expect-error sessionId is never a logger field
      logger.log({ kind: "event", eventCode: "hook.start", sessionId: "x" });
    }
    expect(logger.status()).toEqual({ accepted: 0, dropped: 0 });
  });

  it("contains sink exceptions without leaking their messages", () => {
    const logger = createWhitelistLogger({
      sink: () => {
        throw new Error(canary);
      },
    });

    expect(logger.log({ kind: "event", eventCode: "hook.start" })).toBe(false);
    expect(logger.status()).toEqual({ accepted: 0, dropped: 1 });
    expect(JSON.stringify(logger.status())).not.toContain(canary);
  });
});

describe("privacy-safe local metrics", () => {
  it("is disabled by default", () => {
    const records: unknown[] = [];
    const metrics = createMetricsRecorder({ sink: (record) => records.push(record) });
    expect(metrics.record({ kind: "operation", metric: "context", outcome: "success" })).toBe(false);
    expect(records).toEqual([]);
    expect(metrics.status()).toEqual({ enabled: false, accepted: 0, dropped: 0 });
  });

  it("treats a non-boolean runtime enabled option as disabled", () => {
    const records: unknown[] = [];
    const options = {
      enabled: canary,
      sink: (record: unknown) => records.push(record),
    } as unknown as Parameters<typeof createMetricsRecorder>[0];
    const metrics = createMetricsRecorder(options);

    expect(metrics.record({ kind: "operation", metric: "context", outcome: "success" })).toBe(false);
    expect(records).toEqual([]);
    expect(metrics.status()).toEqual({ enabled: false, accepted: 0, dropped: 0 });
    expect(JSON.stringify(metrics.status())).not.toContain(canary);
  });

  it("uses only fixed metric values and drops runtime extras", () => {
    const records: unknown[] = [];
    const metrics = createMetricsRecorder({ enabled: true, sink: (record) => records.push(record) });
    const malicious = {
      kind: "operation",
      metric: "candidate",
      outcome: "failure",
      countBucket: "1",
      message: canary,
      projectId: canary,
      token,
    } as unknown as MetricEvent;

    expect(metrics.record(malicious)).toBe(true);
    expect(records).toEqual([
      { schemaVersion: 1, kind: "operation", metric: "candidate", outcome: "failure", countBucket: "1" },
    ]);
    expect(JSON.stringify({ records, status: metrics.status() })).not.toContain(canary);
    expect(JSON.stringify({ records, status: metrics.status() })).not.toContain(token);
  });

  it("snapshots validated metric values exactly once", () => {
    const records: unknown[] = [];
    let metricReads = 0;
    let outcomeReads = 0;
    const changingEvent = {
      kind: "operation",
      get metric() {
        metricReads += 1;
        return metricReads === 1 ? "context" : canary;
      },
      get outcome() {
        outcomeReads += 1;
        return outcomeReads === 1 ? "success" : canary;
      },
    } as unknown as MetricEvent;
    const metrics = createMetricsRecorder({ enabled: true, sink: (record) => records.push(record) });

    expect(metrics.record(changingEvent)).toBe(true);
    expect(records).toEqual([
      { schemaVersion: 1, kind: "operation", metric: "context", outcome: "success" },
    ]);
    expect(JSON.stringify(records)).not.toContain(canary);
  });

  it("rejects invalid fixed vocabulary without forwarding input", () => {
    const records: unknown[] = [];
    const metrics = createMetricsRecorder({ enabled: true, sink: (record) => records.push(record) });
    const invalidEvents = [
      { kind: "operation", metric: canary, outcome: "success" },
      { kind: "operation", metric: "context", outcome: canary },
      { kind: "error", errorCode: canary },
    ] as unknown as readonly MetricEvent[];

    for (const event of invalidEvents) expect(metrics.record(event)).toBe(false);
    expect(records).toEqual([]);
    expect(metrics.status()).toEqual({ enabled: true, accepted: 0, dropped: 3 });
    expect(JSON.stringify(metrics.status())).not.toContain(canary);
  });

  it("contains metric sink exceptions without leaking their messages", () => {
    const metrics = createMetricsRecorder({
      enabled: true,
      sink: () => {
        throw new Error(canary);
      },
    });

    expect(metrics.record({ kind: "error", errorCode: "E_INTERNAL" })).toBe(false);
    expect(metrics.status()).toEqual({ enabled: true, accepted: 0, dropped: 1 });
    expect(JSON.stringify(metrics.status())).not.toContain(canary);
  });
});

it("keeps unknown-error canaries out of every observability surface", () => {
  const diagnostic = toSanitizedDiagnostic(new Error(canary));
  const logRecords: unknown[] = [];
  const metricRecords: unknown[] = [];
  const logger = createWhitelistLogger({ sink: (record) => logRecords.push(record) });
  const metrics = createMetricsRecorder({
    enabled: true,
    sink: (record) => metricRecords.push(record),
  });

  expect(
    logger.log({
      kind: "outcome",
      eventCode: "hook.stop",
      outcomeCode: "failure",
      errorCode: diagnostic.code,
    }),
  ).toBe(true);
  expect(metrics.record({ kind: "error", errorCode: diagnostic.code })).toBe(true);
  expect(
    JSON.stringify({ diagnostic, logRecords, logStatus: logger.status(), metricRecords, metricStatus: metrics.status() }),
  ).not.toContain(canary);
});
