import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:crypto", () => ({ randomUUID: () => "fixed-temporary-id" }));

import { publishNoReplace } from "../../../packages/core/src/fs/publish.js";
import {
  resolveExistingFile,
  resolveWritableFile,
} from "../../../packages/core/src/fs/safe-path.js";

const temporaryRoots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "agent-markdown-fs-integration-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("real filesystem containment", () => {
  it("rejects existing and writable paths through an outside directory link", async () => {
    const temporary = await temporaryRoot();
    const root = path.join(temporary, "root");
    const outside = path.join(temporary, "outside");
    await mkdir(root);
    await mkdir(outside);
    await writeFile(path.join(outside, "outside.md"), "outside", "utf8");
    await symlink(outside, path.join(root, "escape"), process.platform === "win32" ? "junction" : "dir");

    await expect(resolveExistingFile(root, "escape/outside.md")).rejects.toMatchObject({
      code: "E_PATH_ESCAPE",
    });
    await expect(resolveWritableFile(root, "escape/new.md")).rejects.toMatchObject({
      code: "E_PATH_ESCAPE",
    });
  });
});

describe("no-overwrite publication", () => {
  it("publishes complete private bytes and removes its temporary file", async () => {
    const root = await temporaryRoot();
    const inbox = path.join(root, "Inbox");
    await mkdir(inbox);

    await publishNoReplace(root, "Inbox/candidate.md", Buffer.from("candidate", "utf8"));

    expect(await readFile(path.join(inbox, "candidate.md"), "utf8")).toBe("candidate");
    expect(await readdir(inbox)).toEqual(["candidate.md"]);
    if (process.platform !== "win32") {
      expect((await stat(path.join(inbox, "candidate.md"))).mode & 0o777).toBe(0o600);
    }
  });

  it("never changes an existing destination", async () => {
    const root = await temporaryRoot();
    const inbox = path.join(root, "Inbox");
    const destination = path.join(inbox, "candidate.md");
    await mkdir(inbox);
    await writeFile(destination, "original", "utf8");

    await expect(
      publishNoReplace(root, "Inbox/candidate.md", Buffer.from("replacement", "utf8")),
    ).rejects.toMatchObject({ code: "E_ALREADY_EXISTS" });

    expect(await readFile(destination, "utf8")).toBe("original");
    expect(await readdir(inbox)).toEqual(["candidate.md"]);
    expect((await lstat(destination)).isFile()).toBe(true);
  });

  it("does not remove a pre-existing temporary-name collision", async () => {
    const root = await temporaryRoot();
    const inbox = path.join(root, "Inbox");
    const collision = path.join(inbox, ".agent-markdown-fixed-temporary-id.tmp");
    const destination = path.join(inbox, "candidate.md");
    await mkdir(inbox);
    await writeFile(collision, "unrelated", "utf8");

    await expect(
      publishNoReplace(root, "Inbox/candidate.md", Buffer.from("candidate", "utf8")),
    ).rejects.toBeDefined();

    await expect(readFile(collision, "utf8")).resolves.toBe("unrelated");
    await expect(access(destination)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
