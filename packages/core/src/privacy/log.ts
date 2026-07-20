import { isStableErrorCode, type StableErrorCode } from "../errors.js";

export type LogHost = "codex" | "claude" | "cli";
export type ByteBucket = "0" | "1-1k" | "1k-16k" | "16k-256k" | ">256k";
export type CountBucket = "0" | "1" | "2-10" | "11-100" | ">100";
export type DurationBucket = "<10ms" | "10-99ms" | "100-999ms" | "1-9s" | ">=10s";

interface LogFields {
  readonly host?: LogHost;
  readonly projectId?: string;
}

export type WhitelistLogEntry =
  | (LogFields & {
      readonly kind: "event";
      readonly eventCode: string;
    })
  | (LogFields & {
      readonly kind: "outcome";
      readonly eventCode: string;
      readonly outcomeCode: string;
      readonly byteBucket?: ByteBucket;
      readonly countBucket?: CountBucket;
      readonly durationBucket?: DurationBucket;
      readonly errorCode?: StableErrorCode;
    });

export interface WhitelistLogRecord extends LogFields {
  readonly schemaVersion: 1;
  readonly timestamp: string;
  readonly kind: "event" | "outcome";
  readonly eventCode: string;
  readonly outcomeCode?: string;
  readonly byteBucket?: ByteBucket;
  readonly countBucket?: CountBucket;
  readonly durationBucket?: DurationBucket;
  readonly errorCode?: StableErrorCode;
}

export interface WhitelistLoggerOptions {
  readonly sink: (record: WhitelistLogRecord) => void;
  readonly now?: () => Date;
}

export interface WhitelistLoggerStatus {
  readonly accepted: number;
  readonly dropped: number;
}

export interface WhitelistLogger {
  log(entry: WhitelistLogEntry): boolean;
  status(): WhitelistLoggerStatus;
}

const HOSTS = new Set<LogHost>(["codex", "claude", "cli"]);
const BYTE_BUCKETS = new Set<ByteBucket>(["0", "1-1k", "1k-16k", "16k-256k", ">256k"]);
const COUNT_BUCKETS = new Set<CountBucket>(["0", "1", "2-10", "11-100", ">100"]);
const DURATION_BUCKETS = new Set<DurationBucket>([
  "<10ms",
  "10-99ms",
  "100-999ms",
  "1-9s",
  ">=10s",
]);
const CODE_PATTERN = /^[a-z][a-z0-9.-]{0,63}$/u;
const PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/u;

function isCode(value: unknown): value is string {
  return typeof value === "string" && CODE_PATTERN.test(value);
}

function isHost(value: unknown): value is LogHost {
  return typeof value === "string" && HOSTS.has(value as LogHost);
}

function isProjectId(value: unknown): value is string {
  return typeof value === "string" && PROJECT_ID_PATTERN.test(value);
}

export function isByteBucket(value: unknown): value is ByteBucket {
  return typeof value === "string" && BYTE_BUCKETS.has(value as ByteBucket);
}

export function isCountBucket(value: unknown): value is CountBucket {
  return typeof value === "string" && COUNT_BUCKETS.has(value as CountBucket);
}

export function isDurationBucket(value: unknown): value is DurationBucket {
  return typeof value === "string" && DURATION_BUCKETS.has(value as DurationBucket);
}

interface RuntimeLogCandidate {
  readonly kind?: unknown;
  readonly eventCode?: unknown;
  readonly outcomeCode?: unknown;
  readonly host?: unknown;
  readonly projectId?: unknown;
  readonly byteBucket?: unknown;
  readonly countBucket?: unknown;
  readonly durationBucket?: unknown;
  readonly errorCode?: unknown;
}

function buildRecord(entry: WhitelistLogEntry, timestamp: string): WhitelistLogRecord | undefined {
  if (typeof entry !== "object" || entry === null) return undefined;
  const candidate = entry as unknown as RuntimeLogCandidate;
  const kind = candidate.kind;
  const eventCode = candidate.eventCode;
  const host = candidate.host;
  const projectId = candidate.projectId;
  if (!isCode(eventCode)) return undefined;
  if (
    (host !== undefined && !isHost(host)) ||
    (projectId !== undefined && !isProjectId(projectId))
  ) {
    return undefined;
  }

  const shared = {
    schemaVersion: 1 as const,
    timestamp,
    eventCode,
    ...(host === undefined ? {} : { host }),
    ...(projectId === undefined ? {} : { projectId }),
  };
  if (kind === "event") return { ...shared, kind };
  const outcomeCode = candidate.outcomeCode;
  const byteBucket = candidate.byteBucket;
  const countBucket = candidate.countBucket;
  const durationBucket = candidate.durationBucket;
  const errorCode = candidate.errorCode;
  if (
    kind !== "outcome" ||
    !isCode(outcomeCode) ||
    (byteBucket !== undefined && !isByteBucket(byteBucket)) ||
    (countBucket !== undefined && !isCountBucket(countBucket)) ||
    (durationBucket !== undefined && !isDurationBucket(durationBucket)) ||
    (errorCode !== undefined && !isStableErrorCode(errorCode))
  ) {
    return undefined;
  }

  return {
    ...shared,
    kind: "outcome",
    outcomeCode,
    ...(byteBucket === undefined ? {} : { byteBucket }),
    ...(countBucket === undefined ? {} : { countBucket }),
    ...(durationBucket === undefined ? {} : { durationBucket }),
    ...(errorCode === undefined ? {} : { errorCode }),
  };
}

export function createWhitelistLogger(options: WhitelistLoggerOptions): WhitelistLogger {
  const now = options.now ?? (() => new Date());
  let accepted = 0;
  let dropped = 0;

  return {
    log(entry) {
      try {
        const record = buildRecord(entry, Date.prototype.toISOString.call(now()));
        if (record === undefined) {
          dropped += 1;
          return false;
        }
        options.sink(record);
        accepted += 1;
        return true;
      } catch {
        dropped += 1;
        return false;
      }
    },
    status() {
      return { accepted, dropped };
    },
  };
}
