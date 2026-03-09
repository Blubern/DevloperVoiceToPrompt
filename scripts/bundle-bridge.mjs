// scripts/bundle-bridge.mjs
// Build script that:
// 1. Bundles copilot-bridge.mjs + all JS deps into a single file via esbuild
// 2. Optionally downloads a portable Node.js runtime (BUNDLE_NODE=true)

import { build } from "esbuild";
import { mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const tauriDir = join(root, "src-tauri");

// --- 1. esbuild: bundle the bridge into a single file ---

const input = join(tauriDir, "scripts", "copilot-bridge.mjs");
const output = join(tauriDir, "scripts", "copilot-bridge-bundled.mjs");

console.log("[bundle-bridge] Bundling copilot-bridge.mjs...");

await build({
  entryPoints: [input],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outfile: output,
  // vscode-jsonrpc is CommonJS and uses require("util") etc. internally.
  // When bundled as ESM the CJS require() shim can't resolve Node built-ins.
  // Injecting createRequire gives the bundle a working require() function.
  banner: {
    js: 'import { createRequire } from "module"; const require = createRequire(import.meta.url);',
  },
  // @github/copilot is external because the SDK resolves it via
  // import.meta.resolve() at runtime — the user installs the Copilot CLI
  // separately and the SDK finds it on PATH.
  external: ["@github/copilot"],
});
console.log("[bundle-bridge] -> ", output);

// --- 2. Optionally download portable Node.js ---

if (process.env.BUNDLE_NODE === "true") {
  const { downloadNode } = await import("./download-node.mjs");
  const nodeDir = join(tauriDir, "node-runtime");
  const platform = process.env.TARGET_PLATFORM || process.platform;
  const arch = process.env.TARGET_ARCH || process.arch;
  await downloadNode(nodeDir, platform, arch);
} else {
  // Ensure the directory exists (even empty) so Tauri resources glob doesn't error
  const nodeDir = join(tauriDir, "node-runtime");
  if (!existsSync(nodeDir)) mkdirSync(nodeDir, { recursive: true });
  console.log("[bundle-bridge] Skipping Node.js download (set BUNDLE_NODE=true for full build)");
}

console.log("[bundle-bridge] Done.");
