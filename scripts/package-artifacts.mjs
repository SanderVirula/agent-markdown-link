import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginDist = path.join(root, "dist", "plugins");
const marketplaceRoot = path.join(root, "marketplace");
const publicFiles = [
  "CHANGELOG.md",
  "LICENSE",
  "PRIVACY.md",
  "README.md",
  "SECURITY.md",
  "SUPPORT.md",
  "TERMS.md",
  "THIRD_PARTY_NOTICES.md",
];

await rm(pluginDist, { recursive: true, force: true });
await mkdir(pluginDist, { recursive: true });

for (const host of ["codex", "claude"]) {
  const artifact = path.join(pluginDist, host);
  await cp(path.join(root, "plugins", host), artifact, { recursive: true });
  await mkdir(path.join(artifact, "skills"), { recursive: true });
  await cp(
    path.join(root, "skills", "agent-markdown-link"),
    path.join(artifact, "skills", "agent-markdown-link"),
    { recursive: true },
  );
  for (const file of publicFiles) {
    await cp(path.join(root, file), path.join(artifact, file));
  }
  await cp(path.join(root, "assets"), path.join(artifact, "assets"), { recursive: true });
  await mkdir(path.join(artifact, "docs"), { recursive: true });
  await cp(path.join(root, "docs", "INSTALL.md"), path.join(artifact, "docs", "INSTALL.md"));
  await mkdir(path.join(artifact, "docs", "reference"), { recursive: true });
  await cp(
    path.join(root, "docs", "reference", "example-config.json"),
    path.join(artifact, "docs", "reference", "example-config.json"),
  );

  await build({
    entryPoints: {
      "runtime/session-start": path.join(
        root,
        "packages",
        "cli",
        "dist",
        "session-start-entry.js",
      ),
      "skills/agent-markdown-link/scripts/agent-markdown": path.join(
        root,
        "packages",
        "cli",
        "dist",
        "index.js",
      ),
    },
    outdir: artifact,
    outExtension: { ".js": ".mjs" },
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    sourcemap: false,
    logLevel: "silent",
  });

  const marketplaceArtifact = path.join(
    marketplaceRoot,
    host,
    "plugins",
    "agent-markdown-link",
  );
  await rm(marketplaceArtifact, { recursive: true, force: true });
  await mkdir(path.dirname(marketplaceArtifact), { recursive: true });
  await cp(artifact, marketplaceArtifact, { recursive: true });
}
