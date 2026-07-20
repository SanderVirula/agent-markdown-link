import Ajv from "ajv";
import configSchema from "../../../../schemas/config.schema.json" with { type: "json" };

import { isAbsoluteLocalPath, normalizeAbsoluteLocalPath } from "./locations.js";
import {
  ConfigurationError,
  type AgentMarkdownConfigV1,
  type ConfigLimits,
  type ValidatedConfig,
  type ValidatedProjectMapping,
} from "./types.js";

const DEFAULT_LIMITS: ConfigLimits = {
  hookInputBytes: 1_048_576,
  hookOutputBytes: 262_144,
  contextFileBytes: 65_536,
  contextTotalBytes: 131_072,
  candidateBytes: 65_536,
  subprocessOutputBytes: 262_144,
  subprocessTimeoutMs: 10_000,
};

const ajv = new Ajv({ allErrors: true, jsonPointers: true });
const validateAgainstSchema = ajv.compile(configSchema as object);

function hasSchemaVersion(value: unknown): value is { readonly schemaVersion: unknown } {
  return typeof value === "object" && value !== null && "schemaVersion" in value;
}

function invalidConfig(): never {
  throw new ConfigurationError("E_CONFIG_INVALID", "Configuration does not match schema version 1.");
}

function assertLimitRelations(limits: ConfigLimits): void {
  if (limits.contextFileBytes > limits.contextTotalBytes) {
    invalidConfig();
  }
}

function normalizedRootKey(root: string): string {
  return /^[A-Za-z]:[\\/]/u.test(root) ? root.toLowerCase() : root;
}

function applyProjectDefaults(
  project: AgentMarkdownConfigV1["projects"][number],
  globalLimits: ConfigLimits,
  seenRoots: Map<string, string>,
): ValidatedProjectMapping {
  const normalizedRoots = project.workspaceRoots.map(normalizeAbsoluteLocalPath);
  const projectRootKeys = new Set<string>();

  for (const root of normalizedRoots) {
    const key = normalizedRootKey(root);
    if (projectRootKeys.has(key)) {
      invalidConfig();
    }
    projectRootKeys.add(key);

    const existingProjectId = seenRoots.get(key);
    if (existingProjectId !== undefined && existingProjectId !== project.projectId) {
      throw new ConfigurationError(
        "E_PROJECT_AMBIGUOUS",
        "Workspace root belongs to multiple equally specific projects.",
      );
    }
    seenRoots.set(key, project.projectId);
  }

  const contextFileBytes = project.limits?.contextFileBytes ?? globalLimits.contextFileBytes;
  const contextTotalBytes = project.limits?.contextTotalBytes ?? globalLimits.contextTotalBytes;
  if (
    contextFileBytes > globalLimits.contextFileBytes ||
    contextTotalBytes > globalLimits.contextTotalBytes ||
    contextFileBytes > contextTotalBytes
  ) {
    invalidConfig();
  }

  return {
    ...project,
    workspaceRoots: normalizedRoots,
    contextFiles: [...project.contextFiles],
    searchRoots: [...(project.searchRoots ?? [])],
    contextExclusions: [...(project.contextExclusions ?? [])],
    ...(project.limits === undefined ? {} : { limits: { ...project.limits } }),
  };
}

function resolveExecutable(value: string | undefined): string {
  if (value === undefined) {
    return "obsidian";
  }
  return isAbsoluteLocalPath(value) ? normalizeAbsoluteLocalPath(value) : value;
}

export function validateConfig(value: unknown): ValidatedConfig {
  if (hasSchemaVersion(value) && value.schemaVersion !== 1) {
    throw new ConfigurationError(
      "E_CONFIG_VERSION",
      "Unsupported configuration schema version; expected version 1.",
    );
  }

  if (!validateAgainstSchema(value)) {
    invalidConfig();
  }

  const config = value as AgentMarkdownConfigV1;
  const limits = { ...DEFAULT_LIMITS, ...config.limits };
  assertLimitRelations(limits);

  const projectIds = new Set<string>();
  const seenRoots = new Map<string, string>();
  const projects = config.projects.map((project) => {
    if (projectIds.has(project.projectId)) {
      invalidConfig();
    }
    projectIds.add(project.projectId);
    return applyProjectDefaults(project, limits, seenRoots);
  });

  return {
    ...config,
    vaultRoot: normalizeAbsoluteLocalPath(config.vaultRoot),
    ...(config.outboxRoot === undefined
      ? {}
      : { outboxRoot: normalizeAbsoluteLocalPath(config.outboxRoot) }),
    writeMode: config.writeMode ?? "outbox",
    hookPolicy: config.hookPolicy ?? "observe",
    limits,
    contextExclusions: [...(config.contextExclusions ?? [])],
    projects,
    obsidian: { executable: resolveExecutable(config.obsidian?.executable) },
    logging: {
      maxBytes: config.logging?.maxBytes ?? 1_048_576,
      maxFiles: config.logging?.maxFiles ?? 3,
    },
    metrics: { enabled: config.metrics?.enabled ?? false },
  };
}
