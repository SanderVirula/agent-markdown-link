import { mkdir, realpath, stat } from "node:fs/promises";
import path, { posix, win32 } from "node:path";

import { AgentMarkdownError } from "../errors.js";

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;

function unsafePath(): never {
  throw new AgentMarkdownError("E_PATH_UNSAFE");
}

export function validatePortableRelativePath(value: string): string {
  if (
    value.length === 0 ||
    CONTROL_CHARACTER.test(value) ||
    value.includes("\\") ||
    posix.isAbsolute(value) ||
    win32.isAbsolute(value)
  ) {
    unsafePath();
  }

  const segments = value.split("/");
  for (const segment of segments) {
    if (
      segment.length === 0 ||
      segment === "." ||
      segment === ".." ||
      segment.includes(":") ||
      /[. ]$/u.test(segment) ||
      WINDOWS_RESERVED_NAME.test(segment)
    ) {
      unsafePath();
    }
  }

  return value;
}

function contained(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
  );
}

async function canonicalDirectory(directory: string): Promise<string> {
  const canonical = await realpath(directory);
  if (!(await stat(canonical)).isDirectory()) unsafePath();
  return canonical;
}

function joinPortable(root: string, relativePath: string): string {
  return path.join(root, ...relativePath.split("/"));
}

export async function resolveExistingFile(root: string, relativePath: string): Promise<string> {
  const portablePath = validatePortableRelativePath(relativePath);
  const canonicalRoot = await canonicalDirectory(root);
  const canonicalTarget = await realpath(joinPortable(canonicalRoot, portablePath));

  if (!contained(canonicalRoot, canonicalTarget)) {
    throw new AgentMarkdownError("E_PATH_ESCAPE");
  }
  if (!(await stat(canonicalTarget)).isFile()) unsafePath();

  return canonicalTarget;
}

export async function resolveExistingDirectory(root: string, relativePath: string): Promise<string> {
  const portablePath = validatePortableRelativePath(relativePath);
  const canonicalRoot = await canonicalDirectory(root);
  const canonicalTarget = await realpath(joinPortable(canonicalRoot, portablePath));

  if (!contained(canonicalRoot, canonicalTarget)) {
    throw new AgentMarkdownError("E_PATH_ESCAPE");
  }
  if (!(await stat(canonicalTarget)).isDirectory()) unsafePath();

  return canonicalTarget;
}

export async function resolveWritableFile(root: string, relativePath: string): Promise<string> {
  const portablePath = validatePortableRelativePath(relativePath);
  const canonicalRoot = await canonicalDirectory(root);
  const requested = joinPortable(canonicalRoot, portablePath);
  const canonicalParent = await canonicalDirectory(path.dirname(requested));

  if (!contained(canonicalRoot, canonicalParent)) {
    throw new AgentMarkdownError("E_PATH_ESCAPE");
  }

  return path.join(canonicalParent, path.basename(requested));
}

export async function ensurePrivateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
}
