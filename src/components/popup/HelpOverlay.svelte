<script lang="ts">
  import { formatShortcutLabel } from "../../lib/useKeyboardShortcuts";
  import type { AppSettings } from "../../lib/settingsStore";

  let {
    settings,
    open = $bindable(),
  }: {
    settings: AppSettings;
    open: boolean;
  } = $props();
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="help-backdrop" onclick={() => open = false}></div>
  <div class="help-overlay">
    <div class="help-title">Keyboard Shortcuts</div>
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
  </div>
{/if}
