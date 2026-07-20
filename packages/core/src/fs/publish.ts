import { link, open, unlink, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { AgentMarkdownError } from "../errors.js";
import { resolveWritableFile } from "./safe-path.js";

function systemErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const code = (error as { readonly code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function mapPublicationError(error: unknown): never {
  const code = systemErrorCode(error);
  if (code === "EEXIST") throw new AgentMarkdownError("E_ALREADY_EXISTS", { cause: error });
  if (code === "EPERM" || code === "ENOTSUP" || code === "EOPNOTSUPP" || code === "EXDEV") {
    throw new AgentMarkdownError("E_UNSUPPORTED_FILESYSTEM", { cause: error });
  }
  throw error;
}

async function closeQuietly(handle: FileHandle | undefined): Promise<void> {
  if (handle === undefined) return;
  try {
    await handle.close();
  } catch {
    // The operation's primary error remains authoritative.
  }
}

async function unlinkQuietly(filePath: string | undefined): Promise<void> {
  if (filePath === undefined) return;
  try {
    await unlink(filePath);
  } catch (error) {
    if (systemErrorCode(error) !== "ENOENT") throw error;
  }
}

export async function publishNoReplace(
  root: string,
  relativePath: string,
  bytes: Uint8Array,
): Promise<void> {
  const destination = await resolveWritableFile(root, relativePath);
  const parent = path.dirname(destination);
  const temporaryPath = path.join(parent, `.agent-markdown-${randomUUID()}.tmp`);
  let handle: FileHandle | undefined;
  let ownsTemporary = false;

  try {
    handle = await open(temporaryPath, "wx", 0o600);
    ownsTemporary = true;
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;

    const revalidatedDestination = await resolveWritableFile(root, relativePath);
    if (revalidatedDestination !== destination) {
      throw new AgentMarkdownError("E_PATH_ESCAPE");
    }

    try {
      await link(temporaryPath, destination);
    } catch (error) {
      mapPublicationError(error);
    }
  } finally {
    await closeQuietly(handle);
    if (ownsTemporary) await unlinkQuietly(temporaryPath);
  }
}
