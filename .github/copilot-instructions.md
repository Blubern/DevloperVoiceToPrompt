# Developer Voice to Prompt — Copilot Instructions

A Tauri 2 + Svelte 5 desktop dictation app with three speech providers (Web Speech API, Azure Cognitive Services, local Whisper via whisper-rs).

## Architecture

```
src/                        # Svelte 5 frontend (TypeScript)
  components/               # Svelte components
    Popup.svelte            # Dictation popup shell (speech lifecycle, text editing)
    Settings.svelte         # Settings shell (state, tabs, save/revert, isDirty)
    MicButton.svelte        # Reusable mic button with pulse animation
    ShortcutRecorder.svelte # Keyboard shortcut capture UI
    settings/               # Settings tab sub-components
      GeneralTab.svelte     # Theme, shortcuts, behavior toggles
      SpeechTab.svelte      # Provider selector + OS/Azure/Whisper sub-tabs
      PhrasesTab.svelte     # Phrase list CRUD
      TemplatesTab.svelte   # Template CRUD with inline editing
      HistoryTab.svelte     # History toggle, max entries, clear
      UsageTab.svelte       # Stats display, reset
      CopilotTab.svelte     # GitHub Copilot auth flow, model list
    popup/                  # Popup sub-components
      HelpOverlay.svelte    # Keyboard shortcuts help modal
      HistoryPanel.svelte   # Slide-out history sidebar with search
      TemplatesPanel.svelte # Slide-out templates sidebar
  lib/                      # Stores, services, constants, utilities
    constants.ts            # Shared enums, event names, magic values
    settingsStore.ts        # AppSettings type + Tauri invoke wrappers (re-exports speechConstants)
    speechConstants.ts      # SUPPORTED_LANGUAGES and AZURE_REGIONS static data
    speechService.ts        # Barrel re-export + createSpeechProvider factory
    speech/                 # Per-provider speech implementations
      types.ts              # SpeechProvider interface, SpeechCallbacks, AudioDevice types
      speechHelpers.ts      # Microphone permission, device enumeration, Azure connection test
      OsSpeechProvider.ts   # Web Speech API provider
      AzureSpeechProvider.ts # Azure Cognitive Services provider
      WhisperSpeechProvider.ts # Local Whisper rolling-window realtime provider
    historyStore.ts         # Transcription history CRUD (Tauri store)
    usageStore.ts           # Per-provider usage tracking
    templateStore.ts        # Prompt template CRUD
    enhancerTemplateStore.ts # Enhancer template CRUD (imports defaults + migration)
    enhancerDefaults.ts     # Default enhancer template prompt texts
    enhancerMigration.ts    # Template v1→v2 migration logic
    copilotStore.ts         # GitHub Copilot CLI bridge wrappers
    useKeyboardShortcuts.ts # matchesShortcut / formatShortcutLabel
    tauriInvoke.ts          # Typed invoke wrapper
    audioLevelMeter.ts      # Web Audio API level metering for mic visualization
  styles/                   # Global CSS
    themes.css              # Catppuccin Mocha/Latte CSS variables
    base.css                # Reset, fonts, scrollbars
    settings.css            # Shared classes for Settings tabs (.section, .field, .hint, etc.)
    popup.css               # Shared classes for Popup panels (.history-panel, .help-overlay, etc.)
  test/                     # Vitest test files + setup.ts with Tauri mocks

src-tauri/                  # Rust backend
  src/
    main.rs                 # Binary entry (calls lib::run)
    lib.rs                  # App init, global shortcut, plugin wiring (slim orchestrator)
    window_manager.rs       # Popup/settings window lifecycle, geometry persistence
    tray.rs                 # System tray icon + menu setup
    settings.rs             # AppSettings serde struct + load/save (single JSON object in store)
    whisper.rs              # WhisperEngine, model paths, transcription
    copilot/                # GitHub Copilot bridge (directory module)
      mod.rs                # Tauri command handlers + re-exports
      bridge.rs             # BridgeProcess struct, JSON-RPC protocol, CopilotState
      paths.rs              # Executable path resolution (bridge_paths, clean_path)
      types.rs              # CopilotAuthStatus, CopilotModel, BridgeResponse
    commands/               # Tauri IPC command handlers
      mod.rs                # Re-exports
      settings_cmd.rs       # get_settings, save_settings, update_shortcut
      whisper_cmd.rs        # whisper_load_model, whisper_transcribe, whisper_list_models
      models.rs             # whisper_download_model, whisper_delete_model
      window.rs             # toggle_popup, hide_popup, show_settings
```

Two windows: `"main"` (Settings, hidden by default) and `"popup"` (dictation, no decorations, always-on-top).

## Dev Environment Setup (Windows)

### Prerequisites
- Node.js 18+, Rust toolchain (rustup), LLVM (`winget install LLVM.LLVM`)
- VS BuildTools 2022+ with "Desktop development with C++" workload

### First-time setup
```powershell
npm install
```

### Set build environment (required every new terminal)
The Rust build needs C++ headers from VS BuildTools. Run this **before** any `cargo` or `tauri` command:
```powershell
cmd /c '"C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvarsall.bat" x64 && set' 2>&1 | ForEach-Object {
    if ($_ -match "^([^=]+)=(.*)$") {
        [System.Environment]::SetEnvironmentVariable($matches[1], $matches[2], "Process")
    }
}
$env:LIBCLANG_PATH = "C:\Program Files\LLVM\bin"
```
> **Why**: Rust's `vswhere` may find a VS Enterprise install that lacks C++ headers. Sourcing `vcvarsall.bat` from BuildTools overrides `PATH`/`LIB`/`INCLUDE`. `LIBCLANG_PATH` is needed by `whisper-rs-sys` (bindgen).

### Run in dev mode
```powershell
npx tauri dev
```
This starts Vite on `http://localhost:1420` and launches the Tauri app. The Rust backend recompiles on save; the frontend hot-reloads.

### Build for production
```powershell
npx tauri build
```
Output: `src-tauri/target/release/bundle/` (NSIS installer).

## Commands

| Task | Command |
|------|---------|
| Dev mode | `npx tauri dev` |
| Prod build | `npx tauri build` |
| Frontend type-check | `npx svelte-check --tsconfig ./tsconfig.json` |
| Frontend tests | `npx vitest run` |
| Frontend tests (watch) | `npx vitest` |
| Rust check | `cd src-tauri && cargo check` |
| Rust tests | `cd src-tauri && cargo test` |

## Conventions

### Code Structure Guidelines

#### Component decomposition
- **Shell + tabs pattern**: Large settings-style components use a slim shell (state, save/revert, tab bar) that renders focused tab sub-components via `$bindable()` props. See `Settings.svelte` → `settings/*.svelte`.
- **Panel extraction**: Side panels, overlays, and modals that have their own open/close state should be separate components. See `popup/HistoryPanel.svelte`, `popup/HelpOverlay.svelte`.
- **Target size**: Components should stay under ~300 lines. If a component grows beyond that, look for extractable sub-components (panels, tabs, complex form sections).
- **State ownership**: The parent shell owns the state; children receive it via `$bindable()` props and mutate it directly. Avoid prop-drilling more than 2 levels deep.

#### CSS organization
- **Global shared styles** in `src/styles/`: `settings.css` has all classes used by Settings tab sub-components (`.section`, `.field`, `.hint`, `.toggle-btn`, etc.). `popup.css` has classes for Popup sub-components (`.history-panel`, `.help-overlay`, etc.). These are imported in `main.ts`.
- **Component-scoped styles** in `<style>` blocks for layout and structural CSS unique to that component.
- **Theme variables** always from `themes.css` — never hardcode colors.

#### File organization
- **One concern per file**: Each Rust file in `commands/` handles one domain. Each Svelte file in `settings/` handles one tab.
- **Shared logic in `src/lib/`**: Store files (`*Store.ts`) handle data persistence. Utility files (`useKeyboardShortcuts.ts`, `constants.ts`) handle reusable logic.
- **No inline magic values**: All provider names, event names, window labels, and thresholds go in `constants.ts`.

#### Rust backend patterns
- **Serde for settings**: Use `#[serde(default)]` on `AppSettings` so adding a field only requires updating the struct + `Default` impl. Never manually read individual store keys.
- **Domain-focused command files**: Group related Tauri commands in the same file under `commands/`. Don't mix settings logic with whisper logic.
- **Validate at boundaries**: Validate IPC inputs (sample rate, base64, model names) in command handlers before processing.

### Frontend (Svelte 5 + TypeScript)
- **Svelte 5 runes**: Use `$state()`, `$derived()`, `$effect()` — never legacy `let`-based reactivity or Svelte stores.
- **Constants in `src/lib/constants.ts`**: Provider names (`PROVIDER_OS`, `PROVIDER_AZURE`, `PROVIDER_WHISPER`), window labels, event names, thresholds. Never inline magic strings.
- **Keyboard shortcuts**: Use `matchesShortcut()` and `formatShortcutLabel()` from `src/lib/useKeyboardShortcuts.ts`.
- **Tauri IPC**: Use `invoke()` from `@tauri-apps/api/core`. Store types mirror Rust structs.
- **CSS**: Theme variables in `src/styles/themes.css` (Catppuccin Mocha/Latte). Shared component classes in `settings.css` and `popup.css` (imported globally in `main.ts`). Component-specific layout styles go in scoped `<style>` blocks.
- **Test files**: Co-located in `src/test/`, named `*.test.ts`. Tauri APIs are mocked in `src/test/setup.ts`.

### Backend (Rust / Tauri 2)
- **Settings**: Single serde struct `AppSettings` in `src-tauri/src/settings.rs` with `#[serde(default)]`. Stored as one JSON object under `"app_settings"` key. Adding a field = add to struct + `Default` impl only.
- **Commands**: Organized by domain in `src-tauri/src/commands/`. Each file has focused Tauri commands.
- **Error handling**: Commands return `Result<T, String>`. Use `?` with `.map_err(|e| format!(...))`.
- **Whisper**: CPU-bound work in `tokio::task::spawn_blocking`. Model names validated against `WHISPER_MODELS` constant to prevent path traversal.
- **Copilot bridge**: JSON-RPC over stdin/stdout to `copilot-bridge.mjs` (Node.js). 30-second timeout on calls.

## Pitfalls

- **VS Enterprise vs BuildTools (`msvcrt.lib` linker error)**: Rust's `vswhere` picks Enterprise first but it lacks C++ headers and CRT libraries. This causes `LINK : fatal error LNK1104: cannot open file 'msvcrt.lib'` during `cargo build` / `cargo run` / `npx tauri dev`. Note that `cargo check` still passes because it only compiles without linking. Always source `vcvarsall.bat` from BuildTools **in the same terminal session** before building. The environment variables (`PATH`, `LIB`, `INCLUDE`) do not persist across terminals.
- **`LIBCLANG_PATH`**: Must be set to `C:\Program Files\LLVM\bin` for `whisper-rs-sys` bindgen. Without it, `cargo build` fails on `whisper-rs-sys`. Install LLVM with `winget install LLVM.LLVM`.
- **`tauri_plugin_store::StoreExt`**: Must be imported to call `.store()` on `AppHandle`.
- **Global shortcut `on_shortcut`**: Takes `&str`, not `&String` — use `.as_str()`.
- **Settings migration**: Old per-field store keys are auto-migrated to single `"app_settings"` object on first load. Both formats work.
