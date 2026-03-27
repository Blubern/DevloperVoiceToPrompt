# Development

This document covers local setup, build requirements, troubleshooting, and the high-level architecture for Developer Voice to Prompt.

## Stack

### Frontend

- [Svelte 5](https://svelte.dev/) for the UI
- [Vite 6](https://vite.dev/) for dev server and bundling
- [TypeScript 5](https://www.typescriptlang.org/) for type safety

### Backend

- [Tauri 2](https://v2.tauri.app/) for the desktop shell
- [Rust](https://www.rust-lang.org/) for backend logic, tray integration, shortcuts, MCP, and Whisper integration

### Key Libraries

| Package | Purpose |
| --- | --- |
| `@github/copilot-sdk` | Prompt enhancement through GitHub Copilot models |
| `microsoft-cognitiveservices-speech-sdk` | Azure Speech transcription |
| `@tauri-apps/api` | Frontend access to Tauri APIs |
| `@tauri-apps/plugin-clipboard-manager` | Clipboard integration |
| `@tauri-apps/plugin-global-shortcut` | Global shortcut integration |
| `@tauri-apps/plugin-store` | Persistent settings and local data |
| `@tauri-apps/plugin-process` | Process management |

| Crate | Purpose |
| --- | --- |
| `tauri` | Core desktop framework |
| `tauri-plugin-global-shortcut` | Global shortcut backend |
| `tauri-plugin-clipboard-manager` | Clipboard backend |
| `tauri-plugin-store` | JSON-based persistence |
| `tauri-plugin-process` | Process lifecycle support |
| `zip` | ZIP extraction for CLI binary management |
| `serde` / `serde_json` | Serialization |

## Speech Provider Plugin System

Speech providers use a **plugin architecture** — each provider is a self-contained module that registers with a central `SpeechProviderRegistry`. Adding a new provider requires only creating a plugin directory under `src/lib/speech/plugins/`. No changes to Popup, Settings, or other core files.

Three execution contexts are supported:

| Context | Description | Examples |
|---------|-------------|---------|
| `browser` | Runs entirely in TypeScript/WebView | Web Speech API, Azure SDK |
| `native` | Runs entirely in Rust via `NativeSpeechProvider` trait | Apple Speech, Windows Speech *(planned)* |
| `hybrid` | TS captures audio, Rust processes | Whisper (whisper.cpp server) |

See **[doc/speech-plugin-architecture.md](doc/speech-plugin-architecture.md)** for the full developer guide on creating new providers.

## Prerequisites

| Dependency | Purpose |
| --- | --- |
| Node.js 18+ | Frontend toolchain |
| Rust toolchain | Backend compilation |
| Windows: VS Build Tools 2022+ | Required C++ toolchain for linking |

## Windows Setup

Install these dependencies before trying to run `npx tauri dev`:

| Tool | Required | Install command | Link |
| --- | --- | --- | --- |
| Node.js LTS | Yes | `winget install OpenJS.NodeJS.LTS` | https://nodejs.org/ |
| Rust toolchain (`rustup`) | Yes | `winget install Rustlang.Rustup` | https://rustup.rs/ |
| Visual Studio 2022 Build Tools | Yes | `winget install Microsoft.VisualStudio.2022.BuildTools` | https://visualstudio.microsoft.com/downloads/ |

After installing Visual Studio Build Tools, open the Visual Studio Installer and make sure the `Desktop development with C++` workload is installed. The Rust linker step for Tauri will fail without it.

Recommended checks:

```powershell
node --version
npm --version
rustc --version
cargo --version
```

## Getting Started

1. Clone the repository and open a terminal in the repository root.

```bash
git clone <repo-url>
cd DevloperVoiceToPrompt
```

2. Install JavaScript dependencies.

```bash
npm install
```

3. On Windows, prepare the build environment in every new terminal before running Cargo or Tauri commands.

```powershell
cmd /c '"C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvarsall.bat" x64 && set' 2>&1 | ForEach-Object {
    if ($_ -match "^([^=]+)=(.*)$") {
        [System.Environment]::SetEnvironmentVariable($matches[1], $matches[2], "Process")
    }
}
```

4. Start the app in development mode.

```bash
npx tauri dev
```

Important:

- run `npx tauri dev` from the repository root, not from `src/`
- on Windows, run the `vcvarsall.bat` setup in every new terminal before any `cargo` or `tauri` command
- if `npx tauri dev` resolves the wrong package, use `npm run tauri -- dev` from the repository root

## Common Commands

| Task | Command |
| --- | --- |
| Run app in dev mode | `npx tauri dev` |
| Build production app | `npx tauri build` |
| Frontend type check | `npx svelte-check --tsconfig ./tsconfig.json` |
| Frontend tests | `npx vitest run` |
| Frontend tests watch | `npx vitest` |
| Rust check | `cd src-tauri && cargo check` |
| Rust tests | `cd src-tauri && cargo test` |

Production bundles are written to `src-tauri/target/release/bundle/`.

## Testing

Frontend tests live in `src/test/` and use Vitest with Tauri mocks from `src/test/setup.ts`.

Current test files include:

- `src/test/constants.test.ts`
- `src/test/historyStore.test.ts`
- `src/test/usageStore.test.ts`

## Architecture Overview

```text
┌──────────────────────────────────────────────────────┐
│  Tauri (Rust)                                        │
│  ┌───────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │ System    │  │ Global   │  │ Plugin Store     │  │
│  │ Tray      │  │ Shortcut │  │ local JSON data  │  │
│  └───────────┘  └──────────┘  └──────────────────┘  │
│  ┌──────────────────┐  ┌──────────────────────────┐  │
│  │ whisper-server   │  │ Copilot Bridge (Node.js) │  │
│  │ whisper.cpp CLI  │  │ JSON-RPC stdin/stdout    │  │
│  └──────────────────┘  └──────────────────────────┘  │
│          IPC commands (invoke / listen)               │
├──────────────────────────────────────────────────────┤
│  WebView (Svelte 5 + TypeScript)                     │
│  ┌───────────────┐  ┌─────────────────────────────┐  │
│  │ Settings      │  │ Popup (Dictation)           │  │
│  │ Window        │  │ Window                      │  │
│  └───────────────┘  └─────────────────────────────┘  │
│              │                    │                    │
│    ┌─────────┴─────────┐  ┌─────┴──────────────┐     │
│    │ Azure Speech SDK  │  │ Web Speech API     │     │
│    │ WebSocket         │  │ Browser native     │     │
│    └───────────────────┘  └────────────────────┘     │
└──────────────────────────────────────────────────────┘
```

### Two-window design

- Main window: settings UI with tabs and normal window chrome
- Popup window: always-on-top dictation surface with history and templates panels

### Data stores

| File | Contents |
| --- | --- |
| `settings.json` | App settings and window geometry |
| `templates.json` | Prompt templates |
| `enhancer-templates.json` | Prompt enhancement instructions |
| `history.json` | Prompt history |
| `usage.json` | Per-provider usage statistics |

### Main source locations

| Area | Location |
| --- | --- |
| Popup UI | `src/components/Popup.svelte` |
| Settings shell | `src/components/Settings.svelte` |
| Speech providers | `src/lib/speechService.ts` |
| Settings persistence | `src/lib/settingsStore.ts` |
| History | `src/lib/historyStore.ts` |
| Templates | `src/lib/templateStore.ts` |
| Prompt enhancement | `src/lib/copilotStore.ts` |
| Rust app bootstrap | `src-tauri/src/lib.rs` |
| Rust settings | `src-tauri/src/settings.rs` |
| Whisper integration | `src-tauri/src/whisper_cli.rs` |
| MCP server | `src-tauri/src/mcp.rs` |

## MCP Notes

The app can host a local HTTP MCP server for the `voice_to_text` workflow.

Current behavior:

- disabled by default
- binds to `127.0.0.1`
- only one active request at a time
- pending requests time out after 5 minutes
- closing the popup cancels the request

Relevant implementation files:

- `src-tauri/src/mcp.rs`
- `src-tauri/src/commands/mcp_cmd.rs`
- `src/components/settings/GeneralTab.svelte`
- `src/components/Popup.svelte`

## Troubleshooting

### `LINK : fatal error LNK1104: cannot open file 'msvcrt.lib'`

This is the most common Windows build failure.

Cause:

- Rust can discover a Visual Studio install that has an incomplete C++ toolchain.
- Linking fails even though `cargo check` may still pass.

Fix:

Run the `vcvarsall.bat` command from the Build Tools install in the same terminal before building.

```powershell
cmd /c '"C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvarsall.bat" x64 && set' 2>&1 | ForEach-Object {
    if ($_ -match "^([^=]+)=(.*)$") {
        [System.Environment]::SetEnvironmentVariable($matches[1], $matches[2], "Process")
    }
}
```

Important:

- run this in every new terminal session
- `cargo check` succeeding does not prove linking will work

### `npm error could not determine executable to run`

Cause:

- the command was run outside the repository root, commonly from `src/`
- `npx` then resolves the unrelated `tauri` package instead of this repo's local `@tauri-apps/cli`

Fix:

Run the command from the repository root:

```powershell
Set-Location D:\Repositorys\DevloperVoiceToPrompt
npx tauri dev
```

If needed, force usage of the local package script:

```powershell
npm run tauri -- dev
```

## Build and Style Notes

Project-specific working conventions are documented in `.github/copilot-instructions.md`.

Highlights:

- Svelte 5 runes are used throughout the frontend
- constants belong in `src/lib/constants.ts`
- settings are stored as a single serde struct in Rust
- shared styles live in `src/styles/`
- frontend tests live in `src/test/`

## License

MIT