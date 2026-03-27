<script lang="ts">
  import { aiProviderRegistry } from "../../lib/ai/aiService";
  import type { AppSettings } from "../../lib/settingsStore";

  let {
    settings = $bindable(),
  }: {
    settings: AppSettings;
  } = $props();

  const plugins = aiProviderRegistry.getAll();
  let aiSubTab = $state(settings.ai_provider);

  // Ensure every registered plugin has a config entry in ai_provider_configs.
  function ensureConfigs() {
    if (!settings.ai_provider_configs) settings.ai_provider_configs = {};
    let changed = false;
    for (const plugin of plugins) {
      if (!settings.ai_provider_configs[plugin.id]) {
        settings.ai_provider_configs[plugin.id] = plugin.defaultConfig();
        changed = true;
      }
    }
    if (changed) settings = settings;
  }
  ensureConfigs();
</script>

<div class="section">
  <h2>AI Enhancement</h2>

  <label class="field toggle-field">
    <span class="label">Enable AI Enhancement</span>
    <div class="toggle-row">
      <input type="checkbox" class="toggle-checkbox" bind:checked={settings.ai_enabled} />
      <span class="toggle-label">{settings.ai_enabled ? 'On' : 'Off'}</span>
    </div>
    <span class="hint">Enable AI-powered enhancement of your voice transcriptions.</span>
  </label>
</div>

{#if settings.ai_enabled}
  <div class="section" style="margin-top: 12px;">
    <h2>AI Provider</h2>
    <label class="field">
      <span class="label">Default AI Provider</span>
      <select bind:value={settings.ai_provider}>
        {#each plugins as plugin}
          <option value={plugin.id}>{plugin.label}{plugin.description ? ` — ${plugin.description}` : ''}</option>
        {/each}
      </select>
      <span class="hint">Choose which AI service is used for prompt enhancement.</span>
    </label>
  </div>

  {#if plugins.length > 1}
    <div class="speech-sub-tabs">
      {#each plugins as plugin}
        <button type="button" class="speech-sub-tab" class:active={aiSubTab === plugin.id} onclick={() => aiSubTab = plugin.id}>
          {plugin.label}
        </button>
      {/each}
    </div>
  {/if}

  {#each plugins as plugin}
    {#if aiSubTab === plugin.id}
      {@const Component = plugin.SettingsComponent}
      <Component
        bind:config={settings.ai_provider_configs[plugin.id]}
      />
    {/if}
  {/each}
{/if}
