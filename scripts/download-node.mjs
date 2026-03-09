// scripts/download-node.mjs
// Downloads a portable Node.js binary for bundling with the app.
// Usage: imported by bundle-bridge.mjs when BUNDLE_NODE=true
//        or run standalone: node scripts/download-node.mjs

import { createWriteStream, existsSync, mkdirSync, rmSync, chmodSync } from "fs";
import { join } from "path";
import { pipeline } from "stream/promises";
import { createHash } from "crypto";
import { readFile } from "fs/promises";
import { execSync } from "child_process";

// Pin to Node.js 22 LTS — update version + checksums when upgrading
const NODE_VERSION = "v22.14.0";

// SHA-256 checksums for the standalone binaries (from nodejs.org SHASUMS256.txt)
// Windows: checksum for win-x64/node.exe
// macOS: checksum for the .tar.gz archive (node binary extracted from it)
const CHECKSUMS = {
  "win32-x64": "33b1bc1a8aca11fd5a4f2699e51019c63c0af30cf437701d07af69be7706771b",
  "darwin-x64": "6698587713ab565a94a360e091df9f6d91c8fadda6d00f0cf6526e9b40bed250",
  "darwin-arm64": "e9404633bc02a5162c5c573b1e2490f5fb44648345d64a958b17e325729a5e42",
};

/**
 * Download Node.js standalone binary to the given directory.
 * @param {string} outDir  — target directory (e.g. src-tauri/node-runtime/)
 * @param {string} platform — "win32" | "darwin" | "linux"
 * @param {string} arch     — "x64" | "arm64"
 */
export async function downloadNode(outDir, platform, arch) {
  if (existsSync(outDir)) rmSync(outDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });

  const key = `${platform}-${arch}`;
  const isWin = platform === "win32";

  if (isWin) {
    // Windows: download the standalone node.exe directly
    const url = `https://nodejs.org/dist/${NODE_VERSION}/win-${arch}/node.exe`;
    const dest = join(outDir, "node.exe");

    console.log(`[download-node] Downloading ${url}...`);
    await downloadFile(url, dest);
    await verifyChecksum(dest, CHECKSUMS[key]);
    console.log(`[download-node] -> ${dest}`);
  } else if (platform === "darwin") {
    // macOS: download tar.gz, extract just the node binary
    const tarName = `node-${NODE_VERSION}-darwin-${arch}`;
    const url = `https://nodejs.org/dist/${NODE_VERSION}/${tarName}.tar.gz`;
    const tarDest = join(outDir, `${tarName}.tar.gz`);

    console.log(`[download-node] Downloading ${url}...`);
    await downloadFile(url, tarDest);
    await verifyChecksum(tarDest, CHECKSUMS[key]);

    // Extract just the node binary
    console.log(`[download-node] Extracting node binary...`);
    execSync(`tar -xzf "${tarDest}" -C "${outDir}" --strip-components=2 "${tarName}/bin/node"`, {
      stdio: "inherit",
    });
    rmSync(tarDest);
    chmodSync(join(outDir, "node"), 0o755);
    console.log(`[download-node] -> ${join(outDir, "node")}`);
  } else {
    console.warn(`[download-node] Unsupported platform: ${key}. Skipping Node download.`);
    return;
  }
}

async function downloadFile(url, dest) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to download ${url}: ${resp.status} ${resp.statusText}`);
  const fileStream = createWriteStream(dest);
  await pipeline(resp.body, fileStream);
}

async function verifyChecksum(filePath, expected) {
  if (!expected) {
    console.warn(`[download-node] No checksum available, skipping verification`);
    return;
  }
  const data = await readFile(filePath);
  const actual = createHash("sha256").update(data).digest("hex");
  if (actual !== expected) {
    throw new Error(
      `Checksum mismatch for ${filePath}:\n  expected: ${expected}\n  actual:   ${actual}`
    );
  }
  console.log(`[download-node] Checksum verified: ${actual.slice(0, 16)}...`);
}

// Allow running standalone
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("download-node.mjs")) {
  const { dirname, join: pathJoin } = await import("path");
  const { fileURLToPath } = await import("url");
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const outDir = pathJoin(__dirname, "..", "src-tauri", "node-runtime");
  const platform = process.env.TARGET_PLATFORM || process.platform;
  const arch = process.env.TARGET_ARCH || process.arch;
  await downloadNode(outDir, platform, arch);
}
