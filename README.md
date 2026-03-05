# Speech to Text

A lightweight desktop dictation tool powered by Azure Speech Services, built with Tauri v2 and Svelte 5.

## Features

- **Real-time transcription** — live speech-to-text as you speak
- **Multi-language support** — 35+ languages with auto-detection when multiple are selected
- **Editable dictation** — modify transcribed text while still dictating
- **Global keyboard shortcut** — toggle the dictation popup from anywhere
- **System tray** — runs in the background with quick access via tray icon
- **Copy to clipboard** — one-click copy and dismiss
- **Microphone selection** — choose from available audio input devices
- **Dark / Light theme** — Catppuccin Mocha and Latte color palettes
- **Persistent settings** — configuration survives app restarts
- **Always-on-top popup** — floating dictation window stays above other apps

## Tech Stack

### Frontend

- **[Svelte 5](https://svelte.dev/)** — UI framework using runes (`$state`, `$derived`, `$effect`)
- **[Vite 6](https://vite.dev/)** — Build tool and dev server
- **[TypeScript 5](https://www.typescriptlang.org/)** — Type safety

### Backend

- **[Tauri 2](https://v2.tauri.app/)** — Cross-platform desktop framework (Rust core, WebView frontend)
- **[Rust](https://www.rust-lang.org/)** — Backend logic, IPC commands, system tray, global shortcuts

### Libraries

#### JavaScript / TypeScript

| Package | Purpose |
| --- | --- |
| `microsoft-cognitiveservices-speech-sdk` | Azure Speech Services SDK — real-time speech recognition |
| `@tauri-apps/api` | Tauri frontend API (IPC, windows, events) |
| `@tauri-apps/plugin-clipboard-manager` | System clipboard access |
| `@tauri-apps/plugin-global-shortcut` | Global keyboard shortcut registration |
| `@tauri-apps/plugin-store` | Persistent key-value settings storage |
| `@tauri-apps/plugin-process` | Process lifecycle management |

#### Rust (Cargo)

| Crate | Purpose |
| --- | --- |
| `tauri` | Core framework (tray-icon, image-png features) |
| `tauri-plugin-global-shortcut` | Global shortcut backend |
| `tauri-plugin-clipboard-manager` | Clipboard backend |
| `tauri-plugin-store` | Settings persistence (JSON file) |
| `tauri-plugin-process` | Process management |
| `serde` / `serde_json` | Serialization and deserialization |

## Prerequisites

- **Node.js** 18+
- **Rust** toolchain (rustup, cargo)
- **Windows**: Visual Studio Build Tools with the "Desktop development with C++" workload
- **Azure Speech Services** subscription key and region — [create one here](https://portal.azure.com/#create/Microsoft.CognitiveServicesSpeechServices)

## Getting Started

1. **Clone the repository**

   ```bash
   git clone <repo-url>
   cd SpeechToText
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Run in development mode**

   ```bash
   npx tauri dev
   ```

4. **Configure** — on first launch the Settings window opens. Enter your Azure Speech key and region, select languages, and optionally set a global shortcut.

## Building

```bash
npx tauri build
```

The installer is output to `src-tauri/target/release/bundle/`.

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Tauri (Rust)                                   │
│  ┌───────────┐  ┌──────────┐  ┌──────────────┐ │
│  │ System    │  │ Global   │  │ Plugin Store │ │
│  │ Tray      │  │ Shortcut │  │ (settings)   │ │
│  └───────────┘  └──────────┘  └──────────────┘ │
│         IPC commands (invoke / listen)           │
├─────────────────────────────────────────────────┤
│  WebView (Svelte 5 + TypeScript)                │
│  ┌───────────────┐  ┌────────────────────────┐  │
│  │ Settings      │  │ Popup (Dictation)      │  │
│  │ Window        │  │ Window                 │  │
│  │ (520×620)     │  │ (420×320, always-on-   │  │
│  │               │  │  top, no decorations)  │  │
│  └───────────────┘  └────────────────────────┘  │
│              │                    │               │
│         Azure Speech SDK (WebSocket)             │
│              ↕                                    │
│     Azure Speech Services                        │
└─────────────────────────────────────────────────┘
```

**Two-window design:**

- **Main window** — Settings configuration with OS window decorations
- **Popup window** — Floating dictation overlay, draggable custom title bar, no taskbar entry

Settings are stored via `tauri-plugin-store` as a JSON file. The global shortcut is registered at startup from stored settings and re-registered on save. The Azure Speech SDK runs in the WebView, connecting via WebSocket to Azure for real-time transcription.

## Theming

Uses [Catppuccin](https://catppuccin.com/) color palettes:

| Theme | Palette |
| --- | --- |
| Dark | Catppuccin Mocha |
| Light | Catppuccin Latte |

Toggle via the sun/moon icon button in the Settings header.

## License

MIT
