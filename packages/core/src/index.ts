export type {
  HostId,
  LifecycleDependencies,
  LifecycleEvent,
  NormalizedHookInvocation,
  NormalizedHookResult,
} from "./hooks/types.js";
export { assembleContext } from "./context/assemble.js";
export { captureCandidate } from "./candidates/capture.js";
export { parseCandidateRequest, type CandidateRequestV1 } from "./candidates/request.js";
export {
  SEARCH_QUERY_BYTES,
  SEARCH_REQUEST_BYTES,
  SEARCH_TERM_COUNT,
  parseSearchRequest,
  type SearchRequestV1,
} from "./search/request.js";
export { searchMarkdown, type SearchResponseV1 } from "./search/search.js";
export { loadConfig } from "./config/load.js";
export { isAbsoluteLocalPath, resolveConfigPath } from "./config/locations.js";
export { selectProject } from "./config/project.js";
export { validateConfig } from "./config/validate.js";
export type { ResolvedConfig, ResolvedProject } from "./config/types.js";
export {
  AgentMarkdownError,
  toSanitizedDiagnostic,
  type SanitizedDiagnostic,
  type StableErrorCode,
} from "./errors.js";

export const CORE_SCHEMA_VERSION = 1 as const;
