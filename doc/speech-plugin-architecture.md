# Speech Provider Plugin Architecture

This guide explains how to add new speech providers to Developer Voice to Prompt. The plugin system supports providers that run in the browser (TypeScript), on the native OS (Rust), or a hybrid of both.

## Quick Start

To add a new provider, create a plugin directory under `src/lib/speech/plugins/` and register it. **No changes to Popup, Settings, or any core file required.**

```
src/lib/speech/plugins/myprovider/
  index.ts              ← Plugin descriptor (required)
  MyProvider.ts         ← SpeechProvider implementation (browser/hybrid)
  MySettingsTab.svelte  ← Settings UI component (required)
```

## Execution Contexts

Each plugin declares where its recognition logic runs:

| Context | Audio Capture | Recognition | Example |
|---------|--------------|-------------|---------|
| `"browser"` | WebView (`getUserMedia`) | WebView (JS SDK / API) | Web Speech, Azure |
| `"native"` | Rust (OS audio API) | Rust (OS speech API) | Apple Speech, Windows Speech |
| `"hybrid"` | WebView (`getUserMedia`) | Rust (backend process) | Whisper (whisper.cpp server) |

### Browser context

```
WebView: SpeechProvider(TS) ←→ Browser API / Cloud SDK
         No Rust involvement
```

### Native context

```
WebView: NativeProviderProxy(TS)
           │ invoke("native_speech_start") ──→ Rust: NativeSpeechProvider
           │                                     ├─ captures mic natively
           │                                     ├─ runs recognition
           └─ listens Tauri events ←─────────────┘  emits results via SpeechEmitter
```

### Hybrid context

```
WebView: HybridProvider(TS)
           ├─ getUserMedia → AudioWorklet → PCM
           ├─ invoke("backend_transcribe", {audio}) ──→ Rust backend
           └─ processes response ──→ SpeechCallbacks
```

---

## Plugin Interface

Every plugin implements `SpeechProviderPlugin`:

```typescript
interface SpeechProviderPlugin {
  // ── Identity ──
  readonly id: string;                          // "myprovider"
  readonly label: string;                       // "My Provider"
  readonly description?: string;                // shown in Settings dropdown

  // ── Execution ──
  readonly executionContext: "browser" | "native" | "hybrid";
  readonly capabilities: ReadonlySet<ProviderCapability>;

  // ── Language ──
  readonly supportedLanguages: readonly LanguageEntry[];
  readonly languageMode: "single" | "multi" | "none";
  readonly languageConfigKey: string;           // e.g. "language" or "languages"

  // ── Lifecycle ──
  createProvider(config, shared): SpeechProvider;
  defaultConfig(): Record<string, unknown>;
  canStart(config): CanStartResult;
  canStartAsync?(config): Promise<CanStartResult>;  // optional

  // ── UI ──
  readonly SettingsComponent: Component<SettingsTabProps>;
}
```

### Capability Flags

Capabilities gate UI features — the Popup checks capabilities instead of provider IDs:

| Capability | UI Effect |
|-----------|-----------|
| `realtime-metrics` | Shows decode latency badge, RTF badge, backend badge, decode ring animation, performance warning |
| `multi-language` | Language selector renders checkboxes (vs single-select buttons) |
| `audio-level` | Popup skips creating its own AudioLevelMeter; provider reports level via `onAudioLevel` callback |
| `phrase-list` | Settings shows phrase list configuration |
| `auto-punctuation` | Settings shows auto-punctuation toggle |
| `requires-backend` | Indicates provider needs Rust-side server/process management |
| `local-model` | Indicates provider uses locally downloaded models |

### Language Metadata

Each plugin declares its own language support:

- **`supportedLanguages`** — array of `{ code, label }` entries shown in the language selector. Import `SUPPORTED_LANGUAGES` from `speechConstants.ts` for the full list, or define your own subset.
- **`languageMode`** — `"single"` (one language at a time), `"multi"` (multiple simultaneous), or `"none"` (auto-detect, no selector shown).
- **`languageConfigKey`** — the key in `provider_configs[id]` that holds the selected language(s). Convention: `"language"` for single, `"languages"` for multi.

### Validation

- **`canStart(config)`** — synchronous check. Must return `{ ready: true }` or `{ ready: false, error: "user-facing message" }`. The Popup displays the error verbatim.
- **`canStartAsync(config)`** — optional async check for validations needing Rust backend calls (e.g. checking if a model is downloaded). When present, the Popup uses this instead of `canStart()`.

---

## Creating a Browser Plugin

### Step 1: Implement `SpeechProvider`

```typescript
// src/lib/speech/plugins/myprovider/MyProvider.ts
import type { SpeechCallbacks, SpeechProvider } from "../../types";

export class MyProvider implements SpeechProvider {
  constructor(private language: string, private apiKey: string) {}

  start(callbacks: SpeechCallbacks): void {
    // Initialize recognition...
    callbacks.onStatusChange("listening");

    // During recognition:
    callbacks.onInterim("partial text...");     // interim results
    callbacks.onFinal("committed text");        // final results
    callbacks.onError("error message");         // errors

    // Optional (declare matching capability):
    // callbacks.onAudioLevel?.(0.5);           // requires "audio-level"
    // callbacks.onDecodeLatency?.(150);         // requires "realtime-metrics"
  }

  async stop(): Promise<void> {
    // Stop recognition, release resources
  }

  dispose(): void {
    // Final cleanup
  }
}
```

### Step 2: Write the plugin descriptor

```typescript
// src/lib/speech/plugins/myprovider/index.ts
import type { SpeechProviderPlugin, SharedConfig } from "../../registry";
import { MyProvider } from "./MyProvider";
import { SUPPORTED_LANGUAGES } from "../../../speechConstants";
import MySettingsTab from "./MySettingsTab.svelte";

const myPlugin: SpeechProviderPlugin = {
  id: "myprovider",
  label: "My Provider",
  description: "My custom speech recognition engine",
  executionContext: "browser",
  capabilities: new Set(["auto-punctuation"]),

  supportedLanguages: SUPPORTED_LANGUAGES,
  languageMode: "single",
  languageConfigKey: "language",

  defaultConfig() {
    return { language: "en-US", api_key: "" };
  },

  canStart(config) {
    if (!config.api_key) {
      return { ready: false, error: "API key required. Go to Settings → Speech." };
    }
    return { ready: true };
  },

  createProvider(config, shared) {
    return new MyProvider(
      (config.language as string) ?? "en-US",
      (config.api_key as string) ?? "",
    );
  },

  SettingsComponent: MySettingsTab as any,
};

export default myPlugin;
```

### Step 3: Create the Settings component

Use classes from `src/styles/settings.css` (`.section`, `.field`, `.hint`, `.toggle-btn`, `.toggle-row`, etc.) for consistent styling.

```svelte
<!-- src/lib/speech/plugins/myprovider/MySettingsTab.svelte -->
<script lang="ts">
  import type { AudioDevice } from "../../../speechService";

  let {
    config = $bindable(),
    audioDevices,
    micWarning,
    microphoneDeviceId = $bindable(),
  }: {
    config: Record<string, unknown>;
    audioDevices: AudioDevice[];
    micWarning: string;
    microphoneDeviceId: string;
  } = $props();
</script>

<div class="section">
  <h2>My Provider Settings</h2>
  <label class="field">
    <span class="label">API Key</span>
    <input type="password" value={config.api_key ?? ""}
      oninput={(e) => config.api_key = (e.target as HTMLInputElement).value} />
    <span class="hint">Enter your API key.</span>
  </label>
  <label class="field">
    <span class="label">Microphone</span>
    <select bind:value={microphoneDeviceId}>
      <option value="">System Default</option>
      {#each audioDevices as device}
        <option value={device.deviceId}>{device.label}</option>
      {/each}
    </select>
  </label>
</div>
```

### Step 4: Register

Add one line in `src/lib/speech/plugins/index.ts`:

```typescript
import myPlugin from "./myprovider";
providerRegistry.register(myPlugin);
```

**Done.** The provider appears in Settings, Popup, and usage tracking automatically.

---

## Creating a Native Plugin (Rust-side)

For providers using OS-level APIs (Apple `SFSpeechRecognizer`, Windows `SpeechContinuousRecognitionSession`).

### Step 1: Implement `NativeSpeechProvider` in Rust

```rust
// src-tauri/src/speech/apple.rs  (behind #[cfg(target_os = "macos")])
use super::{NativeSpeechProvider, SpeechEmitter};

pub struct AppleSpeechProvider { /* ... */ }

impl AppleSpeechProvider {
    pub fn new() -> Self { Self { /* ... */ } }
}

impl NativeSpeechProvider for AppleSpeechProvider {
    fn id(&self) -> &str { "apple" }

    fn start(&mut self, config: serde_json::Value, emitter: SpeechEmitter) -> Result<(), String> {
        let language = config.get("language")
            .and_then(|v| v.as_str())
            .unwrap_or("en-US");

        // Set up native mic capture + recognition using OS APIs...
        emitter.status("listening");

        // In recognition callbacks:
        // emitter.interim("partial...");
        // emitter.final_text("committed text");
        // emitter.error("something went wrong");
        // emitter.status("idle");  // when done

        Ok(())
    }

    fn stop(&mut self) -> Result<(), String> {
        // Stop recognition, release resources
        Ok(())
    }

    fn is_available(&self) -> bool {
        true  // or check OS version, permissions, etc.
    }
}
```

### Step 2: Register in app setup

In `src-tauri/src/lib.rs`, inside `.setup()`:

```rust
#[cfg(target_os = "macos")]
{
    let registry = app.state::<speech::NativeSpeechRegistry>();
    registry.register(Box::new(speech::apple::AppleSpeechProvider::new()));
}
```

### Step 3: TypeScript plugin descriptor

The key difference: `createProvider()` returns a `NativeProviderProxy` instead of a custom class.

```typescript
// src/lib/speech/plugins/apple/index.ts
import type { SpeechProviderPlugin } from "../../registry";
import { NativeProviderProxy } from "../../NativeProviderProxy";
import { invoke } from "@tauri-apps/api/core";
import AppleSettingsTab from "./AppleSettingsTab.svelte";

const applePlugin: SpeechProviderPlugin = {
  id: "apple",
  label: "Apple Speech",
  description: "macOS native speech recognition",
  executionContext: "native",
  capabilities: new Set(["auto-punctuation"]),

  supportedLanguages: [],  // can be fetched dynamically
  languageMode: "single",
  languageConfigKey: "language",

  defaultConfig() {
    return { language: "en-US", on_device: false };
  },

  canStart() { return { ready: true }; },

  async canStartAsync() {
    const available = await invoke<boolean>("native_speech_available", { providerId: "apple" });
    if (!available) return { ready: false, error: "Apple Speech not available on this system." };
    return { ready: true };
  },

  createProvider(config, shared) {
    return new NativeProviderProxy("apple", {
      ...config,
      microphone: shared.microphone_device_id,
    });
  },

  SettingsComponent: AppleSettingsTab as any,
};

export default applePlugin;
```

### Step 4: Register conditionally

```typescript
// src/lib/speech/plugins/index.ts
const isMac = navigator.platform.toLowerCase().includes("mac");
if (isMac) {
  const { default: applePlugin } = await import("./apple");
  providerRegistry.register(applePlugin);
}
```

---

## Rust Event Protocol

The `SpeechEmitter` (Rust) and `NativeProviderProxy` (TypeScript) communicate via standardized Tauri events:

| Event Name | Payload | `SpeechEmitter` Method |
|-----------|---------|----------------------|
| `speech://{id}/interim` | `{ text: String }` | `emitter.interim("...")` |
| `speech://{id}/final` | `{ text: String }` | `emitter.final_text("...")` |
| `speech://{id}/error` | `{ message: String }` | `emitter.error("...")` |
| `speech://{id}/status` | `{ status: String }` | `emitter.status("listening")` |
| `speech://{id}/audio-level` | `{ level: f32 }` | `emitter.audio_level(0.5)` |
| `speech://{id}/decode-latency` | `{ ms: u64 }` | `emitter.decode_latency(150)` |
| `speech://{id}/performance` | `{ rtf, avgRtf, inferenceMs, backend? }` | `emitter.performance(...)` |

Status values: `"idle"`, `"listening"`, `"error"`.

---

## Settings & Config

Provider configuration is stored in `AppSettings.provider_configs`:

```json
{
  "speech_provider": "whisper",
  "provider_configs": {
    "os": { "language": "en-US", "auto_restart": true, "max_restarts": 3 },
    "azure": { "speech_key": "...", "region": "westus2", "languages": ["en-US"] },
    "whisper": { "model": "base", "language": "en-US", "use_gpu": false }
  }
}
```

- `defaultConfig()` is used to initialize new entries.
- `provider_configs` is auto-populated from legacy flat fields on first load (`migrateProviderConfigs()` in `settingsStore.ts`).
- Settings tab components receive `config` as a `$bindable()` prop and mutate it directly.

---

## File Structure

```
src/lib/speech/
  types.ts                          # SpeechProvider, SpeechCallbacks
  registry.ts                       # SpeechProviderPlugin interface, Registry
  NativeProviderProxy.ts            # Generic TS↔Rust bridge for native providers
  speechHelpers.ts                  # Mic permission, device enum, Azure test
  whisperHelpers.ts                 # Whisper audio processing utilities
  plugins/
    index.ts                        # Registers all built-in plugins
    os/                             # Web Speech API (executionContext: "browser")
    azure/                          # Azure Cognitive Services (browser)
    whisper/                        # Local whisper.cpp (hybrid)

src-tauri/src/speech/
  mod.rs                            # NativeSpeechProvider trait, SpeechEmitter,
                                    # NativeSpeechRegistry, generic Tauri commands
```
