<script lang="ts">
  import { openaiListModels, openaiCheckConnection, type AiModel } from "../../../openaiStore";
  import { onMount } from "svelte";

  let {
    config = $bindable(),
  }: {
    config: Record<string, unknown>;
  } = $props();

  let models = $state<AiModel[]>([]);
  let loading = $state(false);
  let error = $state("");
  let connectionOk = $state<boolean | null>(null);
  let showKey = $state(false);

  let sortedModels = $derived([...models].sort((a, b) => a.name.localeCompare(b.name)));
  let selectedModel = $derived((config.selected_model as string) ?? "");
  let apiKey = $derived((config.api_key as string) ?? "");
  let baseUrl = $derived((config.base_url as string) ?? "");

  onMount(() => {
    if (apiKey && baseUrl) {
      loadModels();
    }
  });

  async function loadModels() {
    if (!apiKey || !baseUrl) return;
    loading = true;
    error = "";
    try {
      models = await openaiListModels(baseUrl, apiKey);
    } catch (e: any) {
      error = String(e);
    } finally {
      loading = false;
    }
  }

  async function testConnection() {
    loading = true;
    error = "";
    connectionOk = null;
    try {
      await openaiCheckConnection(baseUrl, apiKey);
      connectionOk = true;
    } catch (e: any) {
      connectionOk = false;
      error = String(e);
    } finally {
      loading = false;
    }
  }

  function handleApiKeyChange(value: string) {
    config = { ...config, api_key: value };
  }

  function handleBaseUrlChange(value: string) {
    config = { ...config, base_url: value };
  }

  function handleModelChange(modelId: string) {
    config = { ...config, selected_model: modelId };
  }
</script>

<div class="section">
  <h2>OpenAI</h2>

  <div class="speech-notice" style="margin-bottom: 12px;">
    <div class="notice-icon">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
    </div>
    <div class="notice-content">
      <strong>OpenAI-compatible API</strong>
      <p>Works with <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" class="notice-link">OpenAI</a>, Azure OpenAI, OpenRouter, and other compatible services. API key is stored locally in app settings.</p>
    </div>
  </div>

  {#if error}
    <div class="message error" style="margin-bottom: 12px;">{error}</div>
  {/if}

  {#if connectionOk === true}
    <div class="message success" style="margin-bottom: 12px;">Connected successfully</div>
  {/if}

  <div class="field">
    <span class="label">API Key</span>
    <div style="display: flex; gap: 8px; align-items: center;">
      {#if showKey}
        <input
          type="text"
          value={apiKey}
          oninput={(e) => handleApiKeyChange((e.target as HTMLInputElement).value)}
          placeholder="sk-..."
          style="flex: 1;"
        />
      {:else}
        <input
          type="password"
          value={apiKey}
          oninput={(e) => handleApiKeyChange((e.target as HTMLInputElement).value)}
          placeholder="sk-..."
          style="flex: 1;"
        />
      {/if}
      <button type="button" class="toggle-btn" onclick={() => (showKey = !showKey)}>
        {showKey ? "Hide" : "Show"}
      </button>
    </div>
    <span class="hint">Your API key from the provider dashboard.</span>
  </div>

  <div class="field" style="margin-top: 12px;">
    <span class="label">Base URL</span>
    <input
      type="text"
      value={baseUrl}
      oninput={(e) => handleBaseUrlChange((e.target as HTMLInputElement).value)}
      placeholder="https://api.openai.com"
    />
    <span class="hint">e.g. <code>https://api.openai.com</code> · Works with Azure OpenAI, OpenRouter, or other compatible APIs.</span>
  </div>

  {#if apiKey && baseUrl}
    {#if loading}
      <p class="hint" style="margin-top: 12px;">Loading...</p>
    {:else if sortedModels.length > 0}
      <div class="field" style="margin-top: 12px;">
        <span class="label">Model</span>
        <select value={selectedModel} onchange={(e) => handleModelChange((e.target as HTMLSelectElement).value)}>
          <option value="">— Select a model —</option>
          {#each sortedModels as model}
            <option value={model.id}>{model.name}</option>
          {/each}
        </select>
        <span class="hint">Model used for prompt enhancement.</span>
      </div>
    {/if}

    <div style="margin-top: 12px; display: flex; gap: 8px;">
      <button type="button" class="toggle-btn" onclick={loadModels}>Refresh Models</button>
      <button type="button" class="toggle-btn" onclick={testConnection}>Test Connection</button>
    </div>
  {:else}
    <p class="hint" style="margin-top: 12px;">Enter a base URL and API key to get started.</p>
  {/if}
</div>
