export const STABLE_ERROR_CODES = [
  "E_CONFIG_INVALID",
  "E_CONFIG_VERSION",
  "E_PROJECT_AMBIGUOUS",
  "E_PATH_UNSAFE",
  "E_PATH_ESCAPE",
  "E_INPUT_INVALID",
  "E_CAPTURE_DISABLED",
  "E_SIZE_LIMIT",
  "E_SECRET_FOUND",
  "E_ALREADY_EXISTS",
  "E_RECEIPT_ALREADY_RESOLVED",
  "E_RECEIPT_EXPIRED",
  "E_UNSUPPORTED_FILESYSTEM",
  "E_CROSS_DEVICE",
  "E_OUTPUT_LIMIT",
  "E_INTERNAL",
] as const;

export type StableErrorCode = (typeof STABLE_ERROR_CODES)[number];

const SAFE_MESSAGES: Readonly<Record<StableErrorCode, string>> = {
  E_CONFIG_INVALID: "Configuration is invalid.",
  E_CONFIG_VERSION: "Configuration schema version is unsupported.",
  E_PROJECT_AMBIGUOUS: "Project mapping is ambiguous.",
  E_PATH_UNSAFE: "Path is unsafe.",
  E_PATH_ESCAPE: "Path escapes its configured root.",
  E_INPUT_INVALID: "Input is invalid.",
  E_CAPTURE_DISABLED: "Candidate capture is disabled.",
  E_SIZE_LIMIT: "Size limit exceeded.",
  E_SECRET_FOUND: "Candidate contains a possible credential.",
  E_ALREADY_EXISTS: "Destination already exists.",
  E_RECEIPT_ALREADY_RESOLVED: "Receipt is already resolved.",
  E_RECEIPT_EXPIRED: "Receipt has expired.",
  E_UNSUPPORTED_FILESYSTEM: "Filesystem does not support required operations.",
  E_CROSS_DEVICE: "Source and destination must share a filesystem.",
  E_OUTPUT_LIMIT: "Output limit exceeded.",
  E_INTERNAL: "Internal operation failed.",
};

const STABLE_ERROR_CODE_SET = new Set<string>(STABLE_ERROR_CODES);

export interface SanitizedDiagnostic {
  readonly code: StableErrorCode;
  readonly message: string;
}

export interface AgentMarkdownErrorOptions {
  readonly cause?: unknown;
}

export class AgentMarkdownError extends Error {
  public readonly code: StableErrorCode;

  public constructor(code: StableErrorCode, options: AgentMarkdownErrorOptions = {}) {
    super(SAFE_MESSAGES[code], options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "AgentMarkdownError";
    this.code = code;
  }
}

export function isStableErrorCode(value: unknown): value is StableErrorCode {
  return typeof value === "string" && STABLE_ERROR_CODE_SET.has(value);
}

function codeFromUnknown(error: unknown): StableErrorCode {
  try {
    if (typeof error === "object" && error !== null && "code" in error) {
      const code = (error as { readonly code?: unknown }).code;
      if (isStableErrorCode(code)) return code;
    }
  } catch {
    return "E_INTERNAL";
  }
  return "E_INTERNAL";
}

export function toSanitizedDiagnostic(error: unknown): SanitizedDiagnostic {
  const code = codeFromUnknown(error);
  return { code, message: SAFE_MESSAGES[code] };
}
