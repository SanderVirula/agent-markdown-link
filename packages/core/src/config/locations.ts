import { homedir as systemHomedir, platform as systemPlatform } from "node:os";
import { posix, win32 } from "node:path";

import { ConfigurationError } from "./types.js";

const PRODUCT_DIRECTORY = "agent-markdown-link";

type PlatformValue = NodeJS.Platform | (() => NodeJS.Platform);
type HomeValue = string | (() => string);

export interface LocationOptions {
  readonly cliPath?: string;
  readonly envPath?: string;
  readonly platform?: PlatformValue;
  readonly homedir?: HomeValue;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly appData?: string;
  readonly localAppData?: string;
}

function getPlatform(value: PlatformValue | undefined): NodeJS.Platform {
  if (typeof value === "function") {
    return value();
  }
  return value ?? systemPlatform();
}

function getHomedir(value: HomeValue | undefined): string {
  if (typeof value === "function") {
    return value();
  }
  return value ?? systemHomedir();
}

export function isAbsoluteLocalPath(value: string): boolean {
  if (value.startsWith("\\\\") || value.startsWith("//")) {
    return false;
  }
  return posix.isAbsolute(value) || (win32.isAbsolute(value) && /^[A-Za-z]:[\\/]/u.test(value));
}

export function normalizeAbsoluteLocalPath(value: string): string {
  const pathApi = /^[A-Za-z]:[\\/]/u.test(value) ? win32 : posix;
  const resolved = pathApi.resolve(value);
  const root = pathApi.parse(resolved).root;
  return resolved.length === root.length ? resolved : resolved.replace(/[\\/]+$/u, "");
}

function requireAbsoluteOverride(value: string): string {
  if (!isAbsoluteLocalPath(value)) {
    throw new ConfigurationError("E_CONFIG_INVALID", "Configuration path override must be absolute.");
  }
  return normalizeAbsoluteLocalPath(value);
}

function environment(options: LocationOptions): Readonly<Record<string, string | undefined>> {
  return options.env ?? process.env;
}

function firstAbsoluteLocal(candidates: readonly (string | undefined)[], fallback: string): string {
  for (const candidate of candidates) {
    if (candidate !== undefined && isAbsoluteLocalPath(candidate)) {
      return normalizeAbsoluteLocalPath(candidate);
    }
  }
  return normalizeAbsoluteLocalPath(fallback);
}

export function resolveConfigPath(options: LocationOptions = {}): string {
  const platform = getPlatform(options.platform);
  const env = environment(options);
  const override = options.cliPath ?? options.envPath ?? env.AGENT_MARKDOWN_LINK_CONFIG;

  if (override !== undefined) {
    return requireAbsoluteOverride(override);
  }

  const home = getHomedir(options.homedir);
  if (platform === "win32") {
    const appData = firstAbsoluteLocal(
      [options.appData, env.APPDATA],
      win32.join(home, "AppData", "Roaming"),
    );
    return win32.join(appData, PRODUCT_DIRECTORY, "config.json");
  }
  if (platform === "darwin") {
    return posix.join(home, "Library", "Application Support", PRODUCT_DIRECTORY, "config.json");
  }

  const xdgConfigHome = env.XDG_CONFIG_HOME;
  const configHome =
    xdgConfigHome !== undefined && posix.isAbsolute(xdgConfigHome) && isAbsoluteLocalPath(xdgConfigHome)
      ? normalizeAbsoluteLocalPath(xdgConfigHome)
      : posix.join(home, ".config");
  return posix.join(configHome, PRODUCT_DIRECTORY, "config.json");
}

export function resolveStateRoot(options: LocationOptions = {}): string {
  const platform = getPlatform(options.platform);
  const env = environment(options);
  const home = getHomedir(options.homedir);

  if (platform === "win32") {
    const localAppData = firstAbsoluteLocal(
      [options.localAppData, env.LOCALAPPDATA],
      win32.join(home, "AppData", "Local"),
    );
    return win32.join(localAppData, PRODUCT_DIRECTORY);
  }
  if (platform === "darwin") {
    return posix.join(home, "Library", "Application Support", PRODUCT_DIRECTORY, "state");
  }

  const xdgStateHome = env.XDG_STATE_HOME;
  const stateHome =
    xdgStateHome !== undefined && posix.isAbsolute(xdgStateHome) && isAbsoluteLocalPath(xdgStateHome)
      ? normalizeAbsoluteLocalPath(xdgStateHome)
      : posix.join(home, ".local", "state");
  return posix.join(stateHome, PRODUCT_DIRECTORY);
}

export function joinStatePath(stateRoot: string, name: string): string {
  return /^[A-Za-z]:[\\/]/u.test(stateRoot) ? win32.join(stateRoot, name) : posix.join(stateRoot, name);
}
