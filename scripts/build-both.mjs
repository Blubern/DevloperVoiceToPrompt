// scripts/build-both.mjs
// Builds both lite and full Tauri installers in one run.
// Usage: node scripts/build-both.mjs [-- <extra tauri args>]
//
// 1. Build lite (no bundled Node.js)
// 2. Rename lite output
// 3. Download Node.js into node-runtime/
// 4. Build full (bundled Node.js)
// 5. Rename full output

import { execSync } from "child_process";
import { readdirSync, renameSync, mkdirSync, existsSync } from "fs";
import { join, dirname, extname, basename } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const tauriDir = join(root, "src-tauri");

// Forward any extra args (e.g. --target aarch64-apple-darwin)
const extraArgs = process.argv.slice(2).join(" ");

const isWin = process.platform === "win32";
const bundleType = isWin ? "nsis" : "dmg";
const bundleDir = join(tauriDir, "target", "release", "bundle", bundleType);

function run(cmd, env) {
  console.log(`\n> ${cmd}\n`);
  execSync(cmd, { cwd: root, stdio: "inherit", env: { ...process.env, ...env } });
}

function collectArtifacts(suffix) {
  const outDir = join(root, "release");
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  if (!existsSync(bundleDir)) {
    console.warn(`[build-both] Bundle dir not found: ${bundleDir}`);
    return;
  }

  const files = readdirSync(bundleDir);
  for (const file of files) {
    const ext = extname(file);
    const base = basename(file, ext);
    const dest = join(outDir, `${base}-${suffix}${ext}`);
    const src = join(bundleDir, file);
    renameSync(src, dest);
    console.log(`[build-both] ${file} -> release/${basename(dest)}`);
  }
}

// --- 1. Lite build ---
console.log("=== Building LITE (no bundled Node.js) ===");
run(`npx tauri build ${extraArgs}`);
collectArtifacts("lite");

// --- 2. Download Node.js for full build ---
console.log("\n=== Downloading Node.js runtime ===");
run("node scripts/bundle-bridge.mjs", { BUNDLE_NODE: "true" });

// --- 3. Full build ---
console.log("\n=== Building FULL (bundled Node.js) ===");
run(`npx tauri build ${extraArgs}`);
collectArtifacts("full");

console.log("\n=== Done ===");
console.log("Output in:", join(root, "release"));
