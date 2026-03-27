<script lang="ts">
  import { onMount } from "svelte";
  import { getSettings, type AppSettings } from "../lib/settingsStore";
  import { formatShortcutLabel } from "../lib/useKeyboardShortcuts";

  let settings = $state<AppSettings | null>(null);

  onMount(async () => {
    try {
      settings = await getSettings();
    } catch (e) {
      console.error("Failed to load settings:", e);
    }
  });
</script>

<div class="help-page">
  {#if settings}
    <h2 class="help-title">Keyboard Shortcuts</h2>
    <div class="help-grid">
      <span class="help-action">Show Popup</span>
      <kbd>{formatShortcutLabel(settings.shortcut)}</kbd>
      <span class="help-action">Start / Stop Voice</span>
      <kbd>{formatShortcutLabel(settings.popup_voice_shortcut)}</kbd>
      <span class="help-action">Copy & Close</span>
      <kbd>{formatShortcutLabel(settings.popup_copy_shortcut)}</kbd>
      {#if settings.provider_switch_shortcut}
        <span class="help-action">Switch Provider</span>
        <kbd>{formatShortcutLabel(settings.provider_switch_shortcut)}</kbd>
      {/if}
      {#if settings.prompt_enhancer_shortcut}
        <span class="help-action">Enhance Prompt</span>
        <kbd>{formatShortcutLabel(settings.prompt_enhancer_shortcut)}</kbd>
      {/if}
      <span class="help-action">Dismiss</span>
      <kbd>Esc</kbd>
    </div>
    {#if settings.phrase_list.length > 0}
      <div class="help-extra">
        <span class="help-extra-label">Custom phrases:</span> {settings.phrase_list.length} active
      </div>
    {/if}
    <div class="help-tip">Pro tip: Do everything via keyboard — no mouse needed.</div>
  {:else}
    <div class="loading">
      <p>Loading...</p>
    </div>
  {/if}
</div>

<style>
  .help-page {
    padding: 24px;
    background: var(--bg-primary);
    color: var(--text-primary);
    height: 100vh;
    box-sizing: border-box;
  }

  .help-title {
    font-size: 16px;
    font-weight: 700;
    margin: 0 0 16px 0;
    color: var(--text-primary);
  }

  .help-grid {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 8px 16px;
    margin-bottom: 16px;
  }

  .help-action {
    font-size: 13px;
    color: var(--text-secondary);
  }

  kbd {
    font-size: 11px;
    padding: 2px 6px;
    border-radius: 4px;
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text-primary);
    font-family: "SF Mono", "Cascadia Code", "Consolas", monospace;
    font-weight: 600;
    text-align: right;
  }

  .help-extra {
    font-size: 12px;
    color: var(--text-muted);
    margin-bottom: 12px;
  }

  .help-extra-label {
    font-weight: 600;
  }

  .help-tip {
    font-size: 11px;
    color: var(--text-muted);
    font-style: italic;
    margin-top: 16px;
  }

  .loading {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--text-muted);
  }
</style>
