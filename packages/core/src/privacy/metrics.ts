import { isStableErrorCode, type StableErrorCode } from "../errors.js";
import {
  isByteBucket,
  isCountBucket,
  isDurationBucket,
  type ByteBucket,
  type CountBucket,
  type DurationBucket,
} from "./log.js";

export type MetricName = "context" | "candidate" | "receipt" | "flush" | "hook";
export type MetricOutcome = "success" | "failure" | "skipped";

export type MetricEvent =
  | {
      readonly kind: "operation";
      readonly metric: MetricName;
      readonly outcome: MetricOutcome;
      readonly byteBucket?: ByteBucket;
      readonly countBucket?: CountBucket;
      readonly durationBucket?: DurationBucket;
    }
  | {
      readonly kind: "error";
      readonly errorCode: StableErrorCode;
    };

export type MetricRecord = ({ readonly schemaVersion: 1 } & MetricEvent);

export interface MetricsRecorderOptions {
  readonly enabled?: boolean;
  readonly sink: (record: MetricRecord) => void;
}

export interface MetricsStatus {
  readonly enabled: boolean;
  readonly accepted: number;
  readonly dropped: number;
}

export interface MetricsRecorder {
  record(event: MetricEvent): boolean;
  status(): MetricsStatus;
}

const METRIC_NAMES = new Set<MetricName>(["context", "candidate", "receipt", "flush", "hook"]);
const METRIC_OUTCOMES = new Set<MetricOutcome>(["success", "failure", "skipped"]);

interface RuntimeMetricCandidate {
  readonly kind?: unknown;
  readonly metric?: unknown;
  readonly outcome?: unknown;
  readonly byteBucket?: unknown;
  readonly countBucket?: unknown;
  readonly durationBucket?: unknown;
  readonly errorCode?: unknown;
}

function isMetricName(value: unknown): value is MetricName {
  return typeof value === "string" && METRIC_NAMES.has(value as MetricName);
}

function isMetricOutcome(value: unknown): value is MetricOutcome {
  return typeof value === "string" && METRIC_OUTCOMES.has(value as MetricOutcome);
}

function buildMetric(event: MetricEvent): MetricRecord | undefined {
  if (typeof event !== "object" || event === null) return undefined;
  const candidate = event as unknown as RuntimeMetricCandidate;
  const kind = candidate.kind;
  if (kind === "error") {
    const errorCode = candidate.errorCode;
    return isStableErrorCode(errorCode)
      ? { schemaVersion: 1, kind, errorCode }
      : undefined;
  }
  const metric = candidate.metric;
  const outcome = candidate.outcome;
  const byteBucket = candidate.byteBucket;
  const countBucket = candidate.countBucket;
  const durationBucket = candidate.durationBucket;
  if (
    kind !== "operation" ||
    !isMetricName(metric) ||
    !isMetricOutcome(outcome) ||
    (byteBucket !== undefined && !isByteBucket(byteBucket)) ||
    (countBucket !== undefined && !isCountBucket(countBucket)) ||
    (durationBucket !== undefined && !isDurationBucket(durationBucket))
  ) {
    return undefined;
  }
  return {
    schemaVersion: 1,
    kind,
    metric,
    outcome,
    ...(byteBucket === undefined ? {} : { byteBucket }),
    ...(countBucket === undefined ? {} : { countBucket }),
    ...(durationBucket === undefined ? {} : { durationBucket }),
  };
}

export function createMetricsRecorder(options: MetricsRecorderOptions): MetricsRecorder {
  const enabled = options.enabled === true;
  let accepted = 0;
  let dropped = 0;

  return {
    record(event) {
      if (!enabled) return false;
      try {
        const record = buildMetric(event);
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
      return { enabled, accepted, dropped };
    },
  };
}
