<script lang="ts">
  import { listen, type UnlistenFn } from "@tauri-apps/api/event";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { getSettings, type AppSettings } from "./lib/settingsStore";
  import { WINDOW_MAIN, WINDOW_HELP, WINDOW_ABOUT, EVENT_CHECK_FIRST_RUN, EVENT_SETTINGS_UPDATED, PROVIDER_AZURE } from "./lib/constants";
  import Popup from "./components/Popup.svelte";
  import Settings from "./components/Settings.svelte";
  import Help from "./components/Help.svelte";
  import About from "./components/About.svelte";
  import { onMount, onDestroy } from "svelte";

  let view = $state<"popup" | "settings" | "help" | "about">("popup");
  let settings = $state<AppSettings | null>(null);
  let unlisteners: UnlistenFn[] = [];

  function applyTheme(theme: string) {
    document.documentElement.dataset.theme = theme || "dark";
  }

  onMount(async () => {
    // Determine which view to show based on the window label
    const win = getCurrentWindow();
    const label = win.label;

    if (label === WINDOW_MAIN) {
      view = "settings";
    } else if (label === WINDOW_HELP) {
      view = "help";
    } else if (label === WINDOW_ABOUT) {
      view = "about";
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

    // Listen for first-run check: if using Azure with no key, show settings
    unlisteners.push(await listen(EVENT_CHECK_FIRST_RUN, async () => {
      if (settings?.speech_provider === PROVIDER_AZURE && !settings?.azure_speech_key) {
        const mainWin = getCurrentWindow();
        if (mainWin.label === "main") {
          await mainWin.show();
          await mainWin.setFocus();
        }
      }
    }));

    // Listen for settings updates from the settings window
    unlisteners.push(await listen(EVENT_SETTINGS_UPDATED, async () => {
      settings = await getSettings();
      applyTheme(settings.theme);
    }));
  });

  onDestroy(() => {
    unlisteners.forEach((fn) => fn());
    unlisteners = [];
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
{:else if view === "help"}
  <Help />
{:else if view === "about"}
  <About />
{:else}
  <div class="loading">
    <p>Loading...</p>
  </div>
{/if}

<style>
  .loading {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100vh;
    color: var(--text-muted);
  }
</style>
