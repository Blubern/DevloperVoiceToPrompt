<script lang="ts">
  import { ollamaListModels, ollamaCheckConnection, type AiModel } from "../../../ollamaStore";
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

  let sortedModels = $derived([...models].sort((a, b) => a.name.localeCompare(b.name)));
  let selectedModel = $derived((config.selected_model as string) ?? "");
  let serverUrl = $derived((config.server_url as string) ?? "");

  onMount(() => {
    if (serverUrl) {
      loadModels();
    }
  });

  async function loadModels() {
    loading = true;
    error = "";
    try {
      models = await ollamaListModels(serverUrl);
    } catch (e: any) {
      const msg = String(e);
      if (msg.includes("Connection failed") || msg.includes("Connection refused")) {
        error = "Could not connect to Ollama server. Make sure Ollama is running.";
      } else {
        error = msg;
      }
    } finally {
      loading = false;
    }
  }

  async function testConnection() {
    loading = true;
    error = "";
    connectionOk = null;
    try {
      await ollamaCheckConnection(serverUrl);
      connectionOk = true;
    } catch (e: any) {
      connectionOk = false;
      const msg = String(e);
      if (msg.includes("Connection failed") || msg.includes("Connection refused")) {
        error = "Could not connect to Ollama server. Make sure Ollama is running.";
      } else {
        error = msg;
      }
    } finally {
      loading = false;
    }
  }

  function handleServerUrlChange(value: string) {
    config = { ...config, server_url: value };
  }

  function handleModelChange(modelId: string) {
    config = { ...config, selected_model: modelId };
  }
</script>

<div class="section">
  <h2>Ollama</h2>

  <div class="speech-notice" style="margin-bottom: 12px;">
    <div class="notice-icon">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
    </div>
    <div class="notice-content">
      <strong>Local AI Models</strong>
      <p>Requires <a href="https://ollama.com" target="_blank" rel="noopener noreferrer" class="notice-link">Ollama</a> running locally. Models run on your machine — no API key needed.</p>
    </div>
  </div>

  {#if error}
    <div class="message error" style="margin-bottom: 12px;">{error}</div>
  {/if}

  {#if connectionOk === true}
    <div class="message success" style="margin-bottom: 12px;">Connected successfully</div>
  {/if}

  <div class="field">
    <span class="label">Server URL</span>
    <input
      type="text"
      value={serverUrl}
      oninput={(e) => handleServerUrlChange((e.target as HTMLInputElement).value)}
      placeholder="http://localhost:11434"
    />
    <span class="hint">e.g. <code>http://localhost:11434</code> · Change if running on a different host or port.</span>
  </div>

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
      <span class="hint">Model used for prompt enhancement. Pull models with <code>ollama pull &lt;model&gt;</code>.</span>
    </div>
  {/if}

  <div style="margin-top: 12px; display: flex; gap: 8px;">
    <button type="button" class="toggle-btn" onclick={loadModels}>Refresh Models</button>
    <button type="button" class="toggle-btn" onclick={testConnection}>Test Connection</button>
  </div>
</div>
