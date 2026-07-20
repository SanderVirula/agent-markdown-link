import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const forbiddenImports = new Set([
  "child_process",
  "node:child_process",
  "http",
  "node:http",
  "https",
  "node:https",
  "http2",
  "node:http2",
  "net",
  "node:net",
  "tls",
  "node:tls",
  "dgram",
  "node:dgram",
  "dns",
  "node:dns",
  "undici",
]);

async function TypeScriptFiles(directory: string): Promise<readonly string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await TypeScriptFiles(fullPath)));
    else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(fullPath);
  }
  return files;
}

it("keeps network and child-process capability out of production imports, including search", async () => {
  const files = [
    ...(await TypeScriptFiles(path.join(repositoryRoot, "packages", "core", "src"))),
    ...(await TypeScriptFiles(path.join(repositoryRoot, "packages", "cli", "src"))),
  ];
  expect(files).toContain(
    path.join(repositoryRoot, "packages", "core", "src", "search", "search.ts"),
  );
  const violations: string[] = [];

  for (const file of files) {
    const source = await readFile(file, "utf8");
    const specifiers = [
      ...source.matchAll(/\bfrom\s+["']([^"']+)["']/gu),
      ...source.matchAll(/\bimport\s+["']([^"']+)["']/gu),
      ...source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu),
    ].map((match) => match[1]!);
    for (const specifier of specifiers) {
      if (forbiddenImports.has(specifier)) {
        violations.push(`${path.relative(repositoryRoot, file)}:${specifier}`);
      }
    }
  }

  expect(violations).toEqual([]);
});
