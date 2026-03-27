<script lang="ts">
  import { webSpeechAvailable, providerRegistry, type AudioDevice } from "../../lib/speechService";
  import type { AppSettings } from "../../lib/settingsStore";

  let {
    settings = $bindable(),
    audioDevices,
    micWarning,
    isMac = false,
    error = $bindable(),
  }: {
    settings: AppSettings;
    audioDevices: AudioDevice[];
    micWarning: string;
    isMac?: boolean;
    error: string;
  } = $props();

  const plugins = providerRegistry.getAll();
  let speechSubTab = $state(settings.speech_provider);

  // Ensure every registered plugin has a config entry in provider_configs.
  // This must run before rendering so bind:config has a valid target.
  function ensureConfigs() {
    if (!settings.provider_configs) settings.provider_configs = {};
    let changed = false;
    for (const plugin of plugins) {
      if (!settings.provider_configs[plugin.id]) {
        settings.provider_configs[plugin.id] = plugin.defaultConfig();
        changed = true;
      }
    }
    if (changed) settings = settings; // trigger reactivity
  }
  ensureConfigs();
</script>

<div class="section">
  <h2>Speech Provider</h2>
  <label class="field">
    <span class="label">Default Speech Provider</span>
    <select bind:value={settings.speech_provider}>
      {#each plugins as plugin}
        <option value={plugin.id}>{plugin.label}{plugin.description ? ` — ${plugin.description}` : ''}</option>
      {/each}
    </select>
    <span class="hint">Choose which speech engine is used by default when recording.</span>
  </label>
</div>

<div class="speech-sub-tabs">
  {#each plugins as plugin}
    <button type="button" class="speech-sub-tab" class:active={speechSubTab === plugin.id} onclick={() => speechSubTab = plugin.id}>
      {plugin.label}
      {#if plugin.id === 'os' && !webSpeechAvailable}<span class="sub-tab-warn">!</span>{/if}
    </button>
  {/each}
</div>

{#each plugins as plugin}
  {#if speechSubTab === plugin.id}
    {@const Component = plugin.SettingsComponent}
    <Component
      bind:config={settings.provider_configs[plugin.id]}
      {audioDevices}
      {micWarning}
      bind:microphoneDeviceId={settings.microphone_device_id}
      {isMac}
      bind:error
    />
  {/if}
{/each}

