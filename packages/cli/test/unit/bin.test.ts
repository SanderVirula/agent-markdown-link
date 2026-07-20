import { readFile, stat } from "node:fs/promises";

import { expect, it } from "vitest";

const packageUrl = new URL("../../package.json", import.meta.url);
const launcherUrl = new URL("../../bin/agent-markdown.js", import.meta.url);

it("uses a committed executable launcher that exists before the TypeScript build", async () => {
  const packageJson = JSON.parse(await readFile(packageUrl, "utf8")) as {
    readonly bin: Readonly<Record<string, string>>;
    readonly files: readonly string[];
  };

  expect(packageJson.bin).toEqual({ "agent-markdown": "./bin/agent-markdown.js" });
  expect(packageJson.files).toContain("bin");
  expect(await readFile(launcherUrl, "utf8")).toBe(
    '#!/usr/bin/env node\n\nimport "../dist/index.js";\n',
  );
  if (process.platform !== "win32") {
    expect((await stat(launcherUrl)).mode & 0o111).not.toBe(0);
  }
});
