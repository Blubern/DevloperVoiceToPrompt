// copilot-bridge.mjs
// Long-running Node.js process that wraps the official @github/copilot-sdk.
// Communicates with the Rust backend via JSONL over stdin/stdout.
//
// Protocol:
//   Request  (stdin):  { "id": 1, "method": "init"|"auth_status"|"list_models"|"stop" }
//   Response (stdout): { "id": 1, "result": ... }  or  { "id": 1, "error": "..." }

import { CopilotClient } from "@github/copilot-sdk";
import { createInterface } from "readline";

let client = null;

async function handleRequest(req) {
  switch (req.method) {
    case "init": {
      if (client) {
        await client.stop().catch(() => {});
      }
      client = new CopilotClient();
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
