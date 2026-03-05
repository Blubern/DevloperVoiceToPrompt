<script lang="ts">
  import { listen } from "@tauri-apps/api/event";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { getSettings, type AppSettings } from "./lib/settingsStore";
  import Popup from "./components/Popup.svelte";
  import Settings from "./components/Settings.svelte";
  import { onMount } from "svelte";

  let view = $state<"popup" | "settings">("popup");
  let settings = $state<AppSettings | null>(null);

  function applyTheme(theme: string) {
    document.documentElement.dataset.theme = theme || "dark";
  }

  onMount(async () => {
    // Determine which view to show based on the window label
    const win = getCurrentWindow();
    const label = win.label;

    if (label === "main") {
      view = "settings";
    } else {
      view = "popup";
    }

    // Load settings
    try {
      settings = await getSettings();
      applyTheme(settings.theme);
    } catch (e) {
      console.error("Failed to load settings:", e);
    }

    // Listen for first-run check: if no key is set, show settings
    listen("check-first-run", async () => {
      if (!settings?.azure_speech_key) {
        const mainWin = getCurrentWindow();
        if (mainWin.label === "main") {
          await mainWin.show();
          await mainWin.setFocus();
        }
      }
    });

    // Listen for settings updates from the settings window
    listen("settings-updated", async () => {
      settings = await getSettings();
      applyTheme(settings.theme);
    });
  });

  function handleSettingsSaved() {
    // Settings were saved, reload them
    getSettings().then((s) => {
      settings = s;
      applyTheme(s.theme);
    });
  }
</script>

{#if view === "popup" && settings}
  <Popup {settings} />
{:else if view === "settings"}
  <Settings initialSettings={settings} onSaved={handleSettingsSaved} />
{:else}
  <div class="loading">
    <p>Loading...</p>
  </div>
{/if}

<style>
  :global(:root),
  :global([data-theme="dark"]) {
    /* Catppuccin Mocha */
    --bg-primary: #1e1e2e;
    --bg-secondary: #181825;
    --input-bg: #11111b;
    --text-primary: #cdd6f4;
    --text-secondary: #a6adc8;
    --text-muted: #7f849c;
    --border: #45475a;
    --surface: #313244;
    --surface-hover: #585b70;
    --accent: #89b4fa;
    --accent-hover: #74c7ec;
    --error: #f38ba8;
    --error-bg: rgba(243, 139, 168, 0.1);
    --error-border: rgba(243, 139, 168, 0.2);
    --success: #a6e3a1;
    --success-bg: rgba(166, 227, 161, 0.1);
    --success-border: rgba(166, 227, 161, 0.2);
    --warning: #f9e2af;
    --warning-bg: rgba(249, 226, 175, 0.05);
    --recording: #f38ba8;
    --recording-glow: rgba(243, 139, 168, 0.15);
    --mic-listening-bg: #1e1e2e;
    --orange: #fab387;
    --lang-tag-bg: rgba(137, 180, 250, 0.12);
    --lang-tag-border: rgba(137, 180, 250, 0.25);
    --scrollbar-track: #181825;
    --scrollbar-thumb: #313244;
  }

  :global([data-theme="light"]) {
    /* Catppuccin Latte */
    --bg-primary: #eff1f5;
    --bg-secondary: #e6e9ef;
    --input-bg: #dce0e8;
    --text-primary: #4c4f69;
    --text-secondary: #6c6f85;
    --text-muted: #7c7f93;
    --border: #bcc0cc;
    --surface: #ccd0da;
    --surface-hover: #acb0be;
    --accent: #1e66f5;
    --accent-hover: #2a6ef6;
    --error: #d20f39;
    --error-bg: rgba(210, 15, 57, 0.08);
    --error-border: rgba(210, 15, 57, 0.15);
    --success: #40a02b;
    --success-bg: rgba(64, 160, 43, 0.08);
    --success-border: rgba(64, 160, 43, 0.15);
    --warning: #df8e1d;
    --warning-bg: rgba(223, 142, 29, 0.08);
    --recording: #d20f39;
    --recording-glow: rgba(210, 15, 57, 0.1);
    --mic-listening-bg: #eff1f5;
    --orange: #fe640b;
    --lang-tag-bg: rgba(30, 102, 245, 0.08);
    --lang-tag-border: rgba(30, 102, 245, 0.2);
    --scrollbar-track: #e6e9ef;
    --scrollbar-thumb: #ccd0da;
  }

  :global(body) {
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
      Oxygen, Ubuntu, Cantarell, sans-serif;
    overflow: hidden;
    background: var(--bg-primary);
    color: var(--text-primary);
  }

  :global(*) {
    box-sizing: border-box;
  }

  /* Themed scrollbars */
  :global(::-webkit-scrollbar) {
    width: 6px;
  }
  :global(::-webkit-scrollbar-track) {
    background: var(--scrollbar-track);
  }
  :global(::-webkit-scrollbar-thumb) {
    background: var(--scrollbar-thumb);
    border-radius: 3px;
  }
  :global(::-webkit-scrollbar-thumb:hover) {
    background: var(--surface-hover);
  }

  .loading {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100vh;
    color: var(--text-muted);
  }
</style>
