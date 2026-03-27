# AI Provider Plugin Architecture

This guide explains how to add new AI providers to Developer Voice to Prompt. The plugin system mirrors the [speech provider plugin architecture](speech-plugin-architecture.md) — each provider is a self-contained directory with a descriptor, provider class, and settings UI.

## Quick Start

To add a new AI provider, create a plugin directory under `src/lib/ai/plugins/` and register it. **No changes to Popup, Settings, or any core file required.**

```
src/lib/ai/plugins/myprovider/
  index.ts                ← Plugin descriptor (required)
  MyProvider.ts           ← AIProvider implementation (required)
  MySettingsTab.svelte    ← Settings UI component (required)
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│  Settings.svelte                                            │
│  ┌──────────┐  ┌──────────────────────────────────────────┐ │
│  │ AITab    │──│ Plugin.SettingsComponent (per provider)  │ │
│  └──────────┘  └──────────────────────────────────────────┘ │
│                                                             │
│  PromptsTab.svelte ← Provider-agnostic prompt templates     │
└─────────────┬───────────────────────────────────────────────┘
              │
              ▼ settings (ai_provider, ai_provider_configs)
┌─────────────────────────────────────────────────────────────┐
│  Popup.svelte                                               │
│  ┌─────────────┐                                            │
│  │ EnhanceBar  │──→ createAIProvider(settings)              │
│  └──────┬──────┘             │                              │
│         │                    ▼                              │
│         │        AIProviderRegistry.get(id)                 │
│         │                    │                              │
│         │          ┌─────────┼──────────┐                   │
│         │          ▼         ▼          ▼                   │
│         │      Copilot   OpenAI     Ollama                  │
│         │          │         │          │                    │
│         ▼          │         ▼          ▼                    │
│    provider.complete()   Tauri IPC → Rust → HTTP            │
│         │          │                                        │
│         │          ▼                                        │
│         │    copilot-bridge.mjs → GitHub SDK                │
│         │      (per-call client)                            │
└─────────┴───────────────────────────────────────────────────┘
```

### Data Flow

1. **Settings** stores `ai_provider` (active ID) and `ai_provider_configs` (per-provider config map)
2. **EnhanceBar** calls `createAIProvider(settings)` to get the active provider
3. The factory looks up the plugin in `AIProviderRegistry` and calls `plugin.createProvider(config)`
4. The provider's `complete()` method delegates to its backend (Copilot SDK, HTTP API, etc.)

---

## Core Types

### `AIProvider` — Provider Interface

```typescript
interface AIProvider {
  /** Run a completion (enhancement) */
  complete(request: AICompletionRequest): Promise<AICompletionResponse>;

  /** Optional streaming variant */
  completeStream?(request: AICompletionRequest, callbacks: AIStreamCallbacks): Promise<void>;

  /** Check if the provider is configured and ready */
  isReady(): boolean | Promise<boolean>;

  /** Optional popup indicator (icon + label for the titlebar) */
  getIndicator?(): Promise<AIProviderIndicator | null>;

  /** Cleanup resources */
  dispose?(): void;
}
```

### `AICompletionRequest` / `AICompletionResponse`

```typescript
interface AICompletionRequest {
  systemPrompt: string;  // Enhancement instructions (from prompt template)
  userText: string;      // User's dictated text
  model?: string;        // Provider-specific model ID
}

interface AICompletionResponse {
  text: string;          // Enhanced text
}
```

### `AIProviderIndicator`

Optional badge shown in the Popup titlebar. Supports dark/light theme variants:

```typescript
interface AIProviderIndicator {
  label: string;          // Fallback text if no icon
  imageUrlDark?: string;  // Icon for dark theme
  imageUrlLight?: string; // Icon for light theme
}
```

### Capability Flags

```typescript
type AIProviderCapability =
  | "streaming"       // Supports token-by-token streaming
  | "requires-auth"   // Needs external auth (e.g. GitHub login)
  | "requires-backend"// Needs Rust-side process management
  | "local-model";    // Uses a locally running model server
```

---

## Plugin Interface

Every plugin implements `AIProviderPlugin`:

```typescript
interface AIProviderPlugin {
  readonly id: string;          // "myprovider" — unique, used as settings key
  readonly label: string;       // "My Provider" — shown in dropdown
  readonly description?: string;
  readonly capabilities: ReadonlySet<AIProviderCapability>;

  createProvider(config: Record<string, unknown>): AIProvider;
  defaultConfig(): Record<string, unknown>;
  canStart(config: Record<string, unknown>): CanStartResult;
  canStartAsync?(config: Record<string, unknown>): Promise<CanStartResult>;
  readonly SettingsComponent: Component<AISettingsTabProps>;
}
```

### Validation

- **`canStart(config)`** — synchronous check. Returns `{ ready: true }` or `{ ready: false, error: "message" }`.
- **`canStartAsync(config)`** — optional async check for validations that need backend calls (e.g. auth status).

---

## Existing Providers

| Provider | ID | Capabilities | Backend | Config Keys |
|----------|----|-------------|---------|-------------|
| GitHub Copilot | `copilot` | `requires-auth`, `requires-backend` | Node.js bridge → GitHub SDK | `selected_model` |
| OpenAI | `openai` | `streaming` | Tauri → Rust → HTTP | `api_key`, `base_url`, `selected_model` |
| Ollama | `ollama` | `local-model` | Tauri → Rust → HTTP | `server_url`, `selected_model` |

### Copilot

Uses a Node.js bridge process (`copilot-bridge.mjs`) that communicates with the GitHub Copilot SDK via JSON-RPC over stdin/stdout. The `CopilotClient` is **created per-call and torn down immediately** — the bridge process stays alive as a lightweight relay, but the SDK agent is ephemeral per operation. This prevents holding locks on the CLI binary and allows CLI updates while the app is running.

### OpenAI

Calls OpenAI-compatible chat completion APIs via Rust HTTP. Works with any OpenAI-compatible endpoint (OpenAI, Azure OpenAI, OpenRouter, etc.). Requires an API key and base URL.

### Ollama

Calls a local Ollama server via Rust HTTP. No API key needed — only a server URL (default: `http://localhost:11434`). Uses the Ollama-specific `/api/tags` endpoint for model listing and the OpenAI-compatible `/v1/chat/completions` endpoint for completions.

---

## Rust Backend

OpenAI and Ollama share an internal `ai_http.rs` module with common HTTP helpers:

```rust
// src-tauri/src/ai_http.rs (internal, not public API)

pub async fn chat_complete(base_url, api_key?, model, system_prompt, user_text, timeout_secs) -> Result<String>;
pub async fn list_models_openai(base_url, api_key) -> Result<Vec<AiModel>>;
pub async fn list_models_ollama(base_url) -> Result<Vec<AiModel>>;
pub async fn check_connection(base_url, api_key?, ollama_style) -> Result<bool>;
```

Each provider has its own Tauri command module:

| Module | Commands |
|--------|----------|
| `commands/openai_cmd.rs` | `openai_complete`, `openai_list_models`, `openai_check_connection` |
| `commands/ollama_cmd.rs` | `ollama_complete`, `ollama_list_models`, `ollama_check_connection` |
| `copilot/mod.rs` | `copilot_auth_status`, `copilot_list_models`, `copilot_enhance` |

### Input Validation

All Rust commands validate inputs at the boundary:
- `user_text` max 10,000 characters
- `model` must be non-empty
- OpenAI commands require non-empty `api_key`
- Timeouts: OpenAI 60s, Ollama 120s (local models can be slow)

---

## Settings Storage

AI settings live in the `AppSettings` struct (Rust) and `settingsStore.ts` (frontend):

```rust
pub struct AppSettings {
    pub ai_enabled: bool,                                       // Master toggle
    pub ai_provider: String,                                    // Active provider ID
    pub ai_selected_enhancer: String,                           // Selected prompt template
    pub prompt_enhancer_shortcut: String,                       // Keyboard shortcut
    pub ai_provider_configs: HashMap<String, serde_json::Value>,// Per-provider config
}
```

Each provider's config is stored under its ID in `ai_provider_configs`:

```json
{
  "ai_provider": "openai",
  "ai_provider_configs": {
    "copilot": { "selected_model": "gpt-4o" },
    "openai": { "api_key": "sk-...", "base_url": "https://api.openai.com", "selected_model": "gpt-4o" },
    "ollama": { "server_url": "http://localhost:11434", "selected_model": "llama3.1" }
  }
}
```

---

## Creating a New Provider

### Step 1: Add Rust Backend (if needed)

If your provider needs HTTP calls, create `src-tauri/src/commands/myprovider_cmd.rs`:

```rust
use crate::ai_http;

#[tauri::command]
pub async fn myprovider_complete(
    base_url: String,
    model: String,
    system_prompt: String,
    user_text: String,
) -> Result<String, String> {
    if user_text.len() > 10_000 {
        return Err("Text too long (max 10 000 chars)".into());
    }
    ai_http::chat_complete(&base_url, None, &model, &system_prompt, &user_text, 60)
        .await
}
```

Register in `src-tauri/src/commands/mod.rs` and add to `invoke_handler` in `src-tauri/src/lib.rs`.

### Step 2: Add Frontend Invoke Wrappers

Create `src/lib/myproviderStore.ts`:

```typescript
import { tauriInvoke } from "./tauriInvoke";
import type { AiModel } from "./openaiStore";

export async function myproviderComplete(
  baseUrl: string, model: string, systemPrompt: string, userText: string,
): Promise<string> {
  return tauriInvoke<string>("myprovider_complete", {
    base_url: baseUrl, model, system_prompt: systemPrompt, user_text: userText,
  });
}
```

### Step 3: Implement `AIProvider`

Create `src/lib/ai/plugins/myprovider/MyProvider.ts`:

```typescript
import type { AIProvider, AICompletionRequest, AICompletionResponse, AIProviderIndicator } from "../../types";
import { myproviderComplete } from "../../../myproviderStore";

export class MyProvider implements AIProvider {
  private baseUrl: string;
  private model: string;

  constructor(config: Record<string, unknown>) {
    this.baseUrl = (config.base_url as string) ?? "";
    this.model = (config.selected_model as string) ?? "";
  }

  async complete(request: AICompletionRequest): Promise<AICompletionResponse> {
    const model = request.model ?? this.model;
    const text = await myproviderComplete(this.baseUrl, model, request.systemPrompt, request.userText);
    return { text };
  }

  isReady(): boolean {
    return !!this.baseUrl && !!this.model;
  }

  async getIndicator(): Promise<AIProviderIndicator | null> {
    if (!this.isReady()) return null;
    return { label: "MyProvider" };
  }

  dispose(): void {}
}
```

### Step 4: Create Settings Component

Create `src/lib/ai/plugins/myprovider/MySettingsTab.svelte`:

Use classes from `src/styles/settings.css` (`.section`, `.field`, `.hint`, etc.) for consistent styling. The component receives a `config` prop that is `$bindable()` — mutate it directly:

```svelte
<script lang="ts">
  let { config = $bindable() }: { config: Record<string, unknown> } = $props();

  let baseUrl = $derived((config.base_url as string) ?? "");

  function setBaseUrl(value: string) {
    config = { ...config, base_url: value };
  }
</script>

<div class="section">
  <label class="field">
    <span>Server URL</span>
    <input type="url" value={baseUrl} oninput={(e) => setBaseUrl(e.currentTarget.value)}
           placeholder="https://example.com" />
    <span class="hint">Your provider's API endpoint</span>
  </label>
</div>
```

### Step 5: Write the Plugin Descriptor

Create `src/lib/ai/plugins/myprovider/index.ts`:

```typescript
import type { AIProviderPlugin } from "../../registry";
import { MyProvider } from "./MyProvider";
import MySettingsTab from "./MySettingsTab.svelte";

const myPlugin: AIProviderPlugin = {
  id: "myprovider",
  label: "My Provider",
  description: "Description shown in provider dropdown",
  capabilities: new Set([]),

  defaultConfig() {
    return { base_url: "", selected_model: "" };
  },

  canStart(config) {
    if (!config.base_url) {
      return { ready: false, error: "Server URL required" };
    }
    return { ready: true };
  },

  createProvider(config) {
    return new MyProvider(config);
  },

  SettingsComponent: MySettingsTab as any,
};

export default myPlugin;
```

### Step 6: Register the Plugin

In `src/lib/ai/plugins/index.ts`:

```typescript
import myPlugin from "./myprovider";

aiProviderRegistry.register(myPlugin);
```

### Step 7: Add Provider Constant

In `src/lib/constants.ts`:

```typescript
export const AI_PROVIDER_MYPROVIDER = "myprovider" as const;
```

---

## Theme-Aware Icons

Provider icons use inline SVG data URIs with Catppuccin palette colors:

| Theme | Background | Foreground |
|-------|-----------|------------|
| Dark (Mocha) | `#cdd6f4` (light) | `#1e1e2e` (dark) |
| Light (Latte) | `#4c4f69` (dark) | `#eff1f5` (light) |

Example:

```typescript
const ICON_DARK = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">' +
  '<circle cx="20" cy="20" r="19" fill="#cdd6f4"/>' +
  '<!-- your shape with fill="#1e1e2e" -->' +
  '</svg>'
)}`;

const ICON_LIGHT = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">' +
  '<circle cx="20" cy="20" r="19" fill="#4c4f69"/>' +
  '<!-- your shape with fill="#eff1f5" -->' +
  '</svg>'
)}`;
```

The Popup picks the correct variant based on the active theme:

```svelte
{@const iconUrl = settings.theme === 'light' ? indicator.imageUrlLight : indicator.imageUrlDark}
```

---

## Testing

Each provider should have tests covering:

| Test | What |
|------|------|
| `complete()` delegation | Verifies IPC call with correct params |
| `isReady()` | True/false based on config |
| `getIndicator()` | Returns correct label and icon URLs |
| Plugin descriptor | `canStart()`, `defaultConfig()`, capabilities |

Test files go in `src/test/`. Tauri IPC mocks are configured in `src/test/setup.ts`.

---

## File Map

```
src/lib/ai/
  types.ts              ← Core interfaces (AIProvider, request/response, capabilities)
  registry.ts           ← AIProviderPlugin interface + AIProviderRegistry singleton
  aiService.ts          ← createAIProvider() factory + re-exports
  plugins/
    index.ts            ← Plugin registration hub
    copilot/
      index.ts          ← Plugin descriptor
      CopilotAIProvider.ts  ← GitHub SDK bridge wrapper
      CopilotSettingsTab.svelte  ← Auth + model UI
    openai/
      index.ts          ← Plugin descriptor
      OpenAIProvider.ts ← HTTP via Rust backend
      OpenAISettingsTab.svelte   ← API key + URL + model UI
    ollama/
      index.ts          ← Plugin descriptor
      OllamaProvider.ts ← HTTP via Rust backend
      OllamaSettingsTab.svelte   ← Server URL + model UI

src-tauri/src/
  ai_http.rs            ← Shared HTTP helpers (chat_complete, list_models, check_connection)
  commands/
    openai_cmd.rs       ← OpenAI Tauri commands
    ollama_cmd.rs       ← Ollama Tauri commands
  copilot/
    mod.rs              ← Copilot Tauri commands (per-call bridge)
```
