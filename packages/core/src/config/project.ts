import { posix, win32 } from "node:path";

import { ConfigurationError, type ResolvedConfig, type ResolvedProject } from "./types.js";

interface Match {
  readonly canonicalRoot: string;
  readonly comparisonRoot: string;
  readonly pathApi: typeof posix;
  readonly project: ResolvedConfig["projects"][number];
}

function pathApiFor(root: string): typeof posix {
  return /^[A-Za-z]:[\\/]/u.test(root) ? win32 : posix;
}

function canonicalize(value: string, pathApi: typeof posix): string {
  const resolved = pathApi.resolve(value);
  const parsed = pathApi.parse(resolved);
  return resolved.length > parsed.root.length ? resolved.replace(/[\\/]+$/u, "") : resolved;
}

function comparisonValue(value: string, pathApi: typeof posix): string {
  return pathApi === win32 ? value.toLocaleLowerCase("en-US") : value;
}

function contains(root: string, cwd: string, separator: string): boolean {
  const descendantPrefix = root.endsWith(separator) ? root : `${root}${separator}`;
  return cwd === root || cwd.startsWith(descendantPrefix);
}

export async function selectProject(
  config: ResolvedConfig,
  cwd: string,
): Promise<ResolvedProject | undefined> {
  const matches: Match[] = [];

  for (const project of config.projects) {
    for (const workspaceRoot of project.workspaceRoots) {
      const pathApi = pathApiFor(workspaceRoot);
      const canonicalRoot = canonicalize(workspaceRoot, pathApi);
      const canonicalCwd = canonicalize(cwd, pathApi);
      const comparisonRoot = comparisonValue(canonicalRoot, pathApi);
      const comparisonCwd = comparisonValue(canonicalCwd, pathApi);

      if (contains(comparisonRoot, comparisonCwd, pathApi.sep)) {
        matches.push({ canonicalRoot, comparisonRoot, pathApi, project });
      }
    }
  }

  if (matches.length === 0) {
    return undefined;
  }

  matches.sort((left, right) => {
    const byLength = right.comparisonRoot.length - left.comparisonRoot.length;
    if (byLength !== 0) {
      return byLength;
    }
    const byRoot = left.comparisonRoot.localeCompare(right.comparisonRoot);
    if (byRoot !== 0) {
      return byRoot;
    }
    return left.project.projectId.localeCompare(right.project.projectId);
  });

  const winner = matches[0];
  if (winner === undefined) {
    return undefined;
  }
  const equallySpecific = matches.filter(
    (match) => match.comparisonRoot.length === winner.comparisonRoot.length,
  );
  if (equallySpecific.some((match) => match.project.projectId !== winner.project.projectId)) {
    throw new ConfigurationError(
      "E_PROJECT_AMBIGUOUS",
      "Working directory matches multiple equally specific projects.",
    );
  }

  return {
    ...winner.project,
    workspaceRoot: winner.canonicalRoot,
    limits: { ...config.limits, ...winner.project.limits },
  };
}
