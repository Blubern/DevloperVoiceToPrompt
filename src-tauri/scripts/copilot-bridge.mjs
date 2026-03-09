// copilot-bridge.mjs
// Long-running Node.js process that wraps the official @github/copilot-sdk.
// Communicates with the Rust backend via JSONL over stdin/stdout.
//
// Protocol:
//   Request  (stdin):  { "id": 1, "method": "init"|"auth_status"|"list_models"|"stop" }
//   Response (stdout): { "id": 1, "result": ... }  or  { "id": 1, "error": "..." }

import { CopilotClient } from "@github/copilot-sdk";
import { createInterface } from "readline";
import { execSync } from "child_process";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

let client = null;

// ---------------------------------------------------------------------------
// Resolve the @github/copilot CLI binary.  Tries every strategy in order so
// it works in dev mode (node_modules present), packaged builds (bundled JS,
// no node_modules), and user-installed global CLI setups.
//
// Strategy 1: import.meta.resolve — Node can find @github/copilot in
//   node_modules directly (dev mode, unbundled builds).
// Strategy 2: Explicit node_modules/.bin lookup — check relative to script,
//   cwd, and NODE_PATH for the copilot binary.
// Strategy 3: PATH lookup via where/which — globally installed Copilot CLI.
// ---------------------------------------------------------------------------
function findCopilotCli() {
  // Strategy 1: Let Node resolve the package directly
  try {
    const resolved = import.meta.resolve("@github/copilot/sdk");
    if (resolved) {
      // The SDK can find @github/copilot itself via import.meta.resolve,
      // so CopilotClient() needs no explicit cliPath.
      return "__SDK_SELF_RESOLVE__";
    }
  } catch { /* not resolvable — package not in node_modules */ }

  // Strategy 2: Check node_modules/.bin in common locations
  const binName = process.platform === "win32" ? "copilot.cmd" : "copilot";
  const candidates = [];

  // Relative to this script file
  try {
    const scriptDir = dirname(fileURLToPath(import.meta.url));
    candidates.push(join(scriptDir, "..", "node_modules", ".bin", binName));
    candidates.push(join(scriptDir, "..", "..", "node_modules", ".bin", binName));
  } catch { /* fileURLToPath may fail for bundled scripts */ }

  // Via NODE_PATH environment variable (set by Rust side)
  if (process.env.NODE_PATH) {
    candidates.push(join(process.env.NODE_PATH, "node_modules", ".bin", binName));
  }

  // Via current working directory
  candidates.push(join(process.cwd(), "node_modules", ".bin", binName));

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }

  // Strategy 3: Fall back to PATH lookup (works when system PATH is available)
  try {
    const cmd = process.platform === "win32" ? "where copilot" : "which copilot";
    const result = execSync(cmd, { encoding: "utf8", timeout: 5000 }).trim().split(/\r?\n/)[0];
    if (result && existsSync(result)) return result;
  } catch { /* where/which failed or not on PATH */ }

  return undefined;
}

async function handleRequest(req) {
  switch (req.method) {
    case "init": {
      if (client) {
        await client.stop().catch(() => {});
      }
      const cliPath = findCopilotCli();
      if (!cliPath) {
        throw new Error(
          "GitHub Copilot CLI not found. Ensure @github/copilot-sdk is installed (npm install) "
          + "or install the Copilot CLI globally: winget install GitHub.Copilot (Windows) / brew install copilot-cli (macOS)"
        );
      }
      // When the SDK can resolve @github/copilot itself, omit cliPath
      if (cliPath === "__SDK_SELF_RESOLVE__") {
        client = new CopilotClient();
      } else {
        client = new CopilotClient({ cliPath });
      }
      await client.start();
      return { ok: true };
    }

    case "auth_status": {
      if (!client) throw new Error("Client not initialized");
      const auth = await client.getAuthStatus();
      return {
        authenticated: auth.isAuthenticated ?? false,
        login: auth.login ?? null,
        host: auth.host ?? null,
        status_message: auth.statusMessage ?? null,
      };
    }

    case "list_models": {
      if (!client) throw new Error("Client not initialized");
      const models = await client.listModels();
      return models.map((m) => ({
        id: m.id,
        name: m.name,
        is_premium: m.billing?.is_premium ?? false,
        multiplier: m.billing?.multiplier ?? 0,
      }));
    }

    case "stop": {
      if (client) {
        await client.stop().catch(() => {});
        client = null;
      }
      return { ok: true };
    }

    case "enhance": {
      if (!client) throw new Error("Client not initialized");
      const { model, system_prompt, user_text, delete_session } = req.params ?? {};
      if (!model || !system_prompt || !user_text) {
        throw new Error("Missing required params: model, system_prompt, user_text");
      }
      const session = await client.createSession({
        model,
        systemMessage: {
          mode: "replace",
          content: system_prompt,
        },
        availableTools: [],
        onPermissionRequest: async () => ({ kind: "denied-by-rules" }),
      });
      const sessionId = session.sessionId;
      try {
        const response = await session.sendAndWait(
          { prompt: user_text },
          30000
        );
        return response?.data?.content ?? "";
      } finally {
        // destroy() handles local cleanup; deleteSession() removes it from the
        // Copilot server. Only call deleteSession when explicitly requested.
        if (delete_session !== false) {
          await session.destroy().catch(() => {});
          await client.deleteSession(sessionId).catch(() => {});
        } else {
          await session.destroy().catch(() => {});
        }
      }
    }

    default:
      throw new Error(`Unknown method: ${req.method}`);
  }
}

// JSONL protocol over stdin/stdout
const rl = createInterface({ input: process.stdin });

rl.on("line", async (line) => {
  let req;
  try {
    req = JSON.parse(line);
  } catch {
    return; // ignore malformed lines
  }

  try {
    const result = await handleRequest(req);
    process.stdout.write(JSON.stringify({ id: req.id, result }) + "\n");
  } catch (e) {
    process.stdout.write(
      JSON.stringify({ id: req.id, error: e?.message ?? String(e) }) + "\n"
    );
  }
});

rl.on("close", async () => {
  if (client) {
    await client.stop().catch(() => {});
  }
  process.exit(0);
});
