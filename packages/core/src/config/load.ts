import { readFile } from "node:fs/promises";

import { joinStatePath, resolveConfigPath, resolveStateRoot, type LocationOptions } from "./locations.js";
import { ConfigurationError, type ResolvedConfig } from "./types.js";
import { validateConfig } from "./validate.js";

export type LoadConfigOptions = LocationOptions;

export async function loadConfig(options: LoadConfigOptions = {}): Promise<ResolvedConfig> {
  const configPath = resolveConfigPath(options);
  let parsed: unknown;

  try {
    parsed = JSON.parse(await readFile(configPath, "utf8"));
  } catch (error: unknown) {
    if (error instanceof ConfigurationError) {
      throw error;
    }
    throw new ConfigurationError("E_CONFIG_INVALID", "Configuration could not be read as JSON.");
  }

  const config = validateConfig(parsed);
  const stateRoot = resolveStateRoot(options);
  return {
    ...config,
    configPath,
    stateRoot,
    outboxRoot: config.outboxRoot ?? joinStatePath(stateRoot, "outbox"),
  };
}
