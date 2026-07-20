export type CaptureMode = "disabled" | "explicit";
export type WriteMode = "outbox" | "inbox";
export type HookPolicy = "observe" | "warn" | "enforce";

export interface ConfigLimits {
  readonly hookInputBytes: number;
  readonly hookOutputBytes: number;
  readonly contextFileBytes: number;
  readonly contextTotalBytes: number;
  readonly candidateBytes: number;
  readonly subprocessOutputBytes: number;
  readonly subprocessTimeoutMs: number;
}

export interface ProjectLimits {
  readonly contextFileBytes?: number;
  readonly contextTotalBytes?: number;
}

export interface ProjectMapping {
  readonly projectId: string;
  readonly workspaceRoots: readonly string[];
  readonly contextFiles: readonly string[];
  readonly searchRoots?: readonly string[];
  readonly contextExclusions?: readonly string[];
  readonly limits?: ProjectLimits;
}

export interface ObsidianSettings {
  readonly executable?: string;
}

export interface LoggingSettings {
  readonly maxBytes?: number;
  readonly maxFiles?: number;
}

export interface MetricsSettings {
  readonly enabled?: boolean;
}

export interface AgentMarkdownConfigV1 {
  readonly schemaVersion: 1;
  readonly vaultRoot: string;
  readonly inboxPath: string;
  readonly outboxRoot?: string;
  readonly captureMode: CaptureMode;
  readonly writeMode?: WriteMode;
  readonly hookPolicy?: HookPolicy;
  readonly limits?: Partial<ConfigLimits>;
  readonly contextExclusions?: readonly string[];
  readonly projects: readonly ProjectMapping[];
  readonly obsidian?: ObsidianSettings;
  readonly logging?: LoggingSettings;
  readonly metrics?: MetricsSettings;
}

export interface ValidatedProjectMapping
  extends Omit<ProjectMapping, "contextExclusions" | "searchRoots"> {
  readonly contextExclusions: readonly string[];
  readonly searchRoots: readonly string[];
}

export interface ValidatedConfig
  extends Omit<
    AgentMarkdownConfigV1,
    | "contextExclusions"
    | "hookPolicy"
    | "limits"
    | "logging"
    | "metrics"
    | "obsidian"
    | "projects"
    | "writeMode"
  > {
  readonly writeMode: WriteMode;
  readonly hookPolicy: HookPolicy;
  readonly limits: ConfigLimits;
  readonly contextExclusions: readonly string[];
  readonly projects: readonly ValidatedProjectMapping[];
  readonly obsidian: Required<ObsidianSettings>;
  readonly logging: Required<LoggingSettings>;
  readonly metrics: Required<MetricsSettings>;
}

export interface ResolvedConfig extends Omit<ValidatedConfig, "outboxRoot"> {
  readonly configPath: string;
  readonly stateRoot: string;
  readonly outboxRoot: string;
}

export interface ResolvedProject extends Omit<ValidatedProjectMapping, "limits"> {
  readonly workspaceRoot: string;
  readonly limits: ConfigLimits;
}

export type ConfigErrorCode = "E_CONFIG_INVALID" | "E_CONFIG_VERSION" | "E_PROJECT_AMBIGUOUS";

export class ConfigurationError extends Error {
  public readonly code: ConfigErrorCode;

  public constructor(code: ConfigErrorCode, message: string) {
    super(message);
    this.name = "ConfigurationError";
    this.code = code;
  }
}
