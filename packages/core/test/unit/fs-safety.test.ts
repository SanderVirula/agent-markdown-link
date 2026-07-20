import { mkdtemp, mkdir, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ensurePrivateDirectory,
  resolveExistingDirectory,
  resolveExistingFile,
  resolveWritableFile,
  validatePortableRelativePath,
} from "../../src/fs/safe-path.js";

const temporaryRoots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "agent-markdown-fs-unit-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("portable relative paths", () => {
  it.each(["Memory/Profile.md", "Memory/Ülevaade 2026.md"])("accepts %s", (value) => {
    expect(validatePortableRelativePath(value)).toBe(value);
  });

  it.each([
    "",
    ".",
    "../outside.md",
    "Memory/../outside.md",
    "Memory\\..\\outside.md",
    "/absolute.md",
    "C:/absolute.md",
    "C:\\absolute.md",
    "\\\\server\\share\\note.md",
    "\\\\?\\C:\\note.md",
    "Memory\\Profile.md",
    "Memory//Profile.md",
    "Memory/./Profile.md",
    "Memory/Profile.md/",
    "Memory/CON",
    "Memory/con.txt",
    "Memory/note:stream.md",
    "Memory/trailing.",
    "Memory/trailing ",
    "Memory/line\nbreak.md",
    "Memory/\u0000note.md",
  ])("rejects unsafe path %j", (value) => {
    expect(() => validatePortableRelativePath(value)).toThrowError(
      expect.objectContaining({ code: "E_PATH_UNSAFE" }),
    );
  });
});

describe("contained filesystem resolution", () => {
  it("resolves only regular files below the real root", async () => {
    const root = await temporaryRoot();
    await mkdir(path.join(root, "Memory"));
    const note = path.join(root, "Memory", "Profile.md");
    await writeFile(note, "profile", "utf8");

    await expect(resolveExistingFile(root, "Memory/Profile.md")).resolves.toBe(
      await realpath(note),
    );
    await expect(resolveExistingFile(root, "Memory")).rejects.toMatchObject({
      code: "E_PATH_UNSAFE",
    });
  });

  it("resolves only contained directories and rejects an outside link", async () => {
    const root = await temporaryRoot();
    const memory = path.join(root, "Memory");
    const note = path.join(root, "note.md");
    const outside = await temporaryRoot();
    await mkdir(memory);
    await writeFile(note, "note", "utf8");
    await symlink(outside, path.join(root, "escape"), process.platform === "win32" ? "junction" : "dir");

    await expect(resolveExistingDirectory(root, "Memory")).resolves.toBe(await realpath(memory));
    await expect(resolveExistingDirectory(root, "note.md")).rejects.toMatchObject({
      code: "E_PATH_UNSAFE",
    });
    await expect(resolveExistingDirectory(root, "escape")).rejects.toMatchObject({
      code: "E_PATH_ESCAPE",
    });
  });

  it("requires the final writable parent to exist below the real root", async () => {
    const root = await temporaryRoot();
    const inbox = path.join(root, "Inbox");
    await mkdir(inbox);

    await expect(resolveWritableFile(root, "Inbox/candidate.md")).resolves.toBe(
      path.join(await realpath(inbox), "candidate.md"),
    );
    await expect(resolveWritableFile(root, "Missing/candidate.md")).rejects.toBeInstanceOf(Error);
  });

  it("creates a private directory recursively", async () => {
    const root = await temporaryRoot();
    const destination = path.join(root, "state", "outbox");

    await ensurePrivateDirectory(destination);

    const metadata = await stat(destination);
    expect(metadata.isDirectory()).toBe(true);
    if (process.platform !== "win32") expect(metadata.mode & 0o777).toBe(0o700);
  });
});
