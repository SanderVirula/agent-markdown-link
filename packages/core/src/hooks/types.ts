export type HostId = "codex" | "claude";
export type LifecycleEvent = "SessionStart" | "UserPromptSubmit" | "PreCompact" | "Stop";

export interface NormalizedHookInvocation {
  readonly schemaVersion: 1;
  readonly host: HostId;
  readonly event: LifecycleEvent;
  readonly cwd: string;
  readonly rawSessionId?: string;
  readonly turnId?: string;
  readonly stopHookActive: boolean;
  readonly pluginDataRoot?: string;
}

export interface NormalizedHookResult {
  readonly continue: true;
  readonly requestContinuation: boolean;
  readonly additionalContext?: string;
  readonly systemMessage?: string;
  readonly diagnosticCodes: readonly string[];
}

export interface LifecycleDependencies {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly now: () => Date;
  readonly monotonicNow: () => bigint;
}
