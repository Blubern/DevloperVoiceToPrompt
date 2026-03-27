<script lang="ts">
  import { copilotAuthStatus, copilotListModels, type CopilotAuthStatus, type CopilotModel } from "../../../copilotStore";
  import { onMount } from "svelte";

  let {
    config = $bindable(),
  }: {
    config: Record<string, unknown>;
  } = $props();

  let auth = $state<CopilotAuthStatus | null>(null);
  let models = $state<CopilotModel[]>([]);
  let loading = $state(false);
  let error = $state("");
  let needsNode = $state(false);
  let needsLogin = $state(false);

  let sortedModels = $derived([...models].sort((a, b) => a.name.localeCompare(b.name)));
  let selectedModel = $derived((config.selected_model as string) ?? "");

  onMount(() => {
    checkAuth();
  });

  async function checkAuth() {
    loading = true;
    error = "";
    needsNode = false;
    needsLogin = false;
    try {
      auth = await copilotAuthStatus();
      if (auth?.authenticated) {
        models = await copilotListModels();
      } else {
        needsLogin = true;
      }
    } catch (e: any) {
      const msg = String(e);
      const msgLower = msg.toLowerCase();
      if (msgLower.includes("@github/copilot-sdk") || msgLower.includes("err_module_not_found")) {
        error = "The installed app could not load the bundled GitHub Copilot runtime. Update or reinstall the app.";
      } else if (msgLower.includes("failed to spawn bridge") || msgLower.includes("os error 2") || msgLower.includes("program not found")) {
        needsNode = true;
      } else {
        error = msg;
      }
    } finally {
      loading = false;
    }
  }

  async function refreshModels() {
    loading = true;
    error = "";
    try {
      models = await copilotListModels();
    } catch (e: any) {
      error = String(e);
    } finally {
      loading = false;
    }
  }

  function handleModelChange(modelId: string) {
    config = { ...config, selected_model: modelId };
  }
</script>

<div class="section">
  <h2>GitHub Copilot</h2>

  <div class="speech-notice" style="margin-bottom: 12px;">
    <div class="notice-icon">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
    </div>
    <div class="notice-content">
      <strong>Requirements</strong>
      <p>This feature requires the <a href="https://docs.github.com/en/copilot/github-copilot-in-the-cli" target="_blank" rel="noopener noreferrer" class="notice-link">GitHub Copilot CLI</a> installed and logged in, plus an active <a href="https://github.com/features/copilot" target="_blank" rel="noopener noreferrer" class="notice-link">Copilot subscription</a>. The <em>full</em> installer bundles Node.js; the <em>lite</em> installer requires <a href="https://nodejs.org/" target="_blank" rel="noopener noreferrer" class="notice-link">Node.js 20+</a> separately.</p>
    </div>
  </div>

  {#if error}
    <div class="message error" style="margin-bottom: 12px;">{error}</div>
  {/if}

  {#if loading}
    <p class="hint">Checking...</p>
  {:else if needsNode}
    <div class="info-box">
      <strong>Node.js not found</strong>
      <p style="margin-top: 8px;">Node.js 20+ is required for the Copilot feature but was not detected. Either:</p>
      <ol style="margin: 8px 0 0 20px; line-height: 1.8;">
        <li>Install <a href="https://nodejs.org/" target="_blank" rel="noopener">Node.js 20+</a> and make sure <code>node</code> is on your PATH</li>
        <li>Or use the <strong>full installer</strong> which bundles Node.js</li>
      </ol>
    </div>
    <button type="button" class="toggle-btn" style="margin-top: 12px;" onclick={checkAuth}>Retry</button>
  {:else if needsLogin}
    <div class="info-box">
      <strong>Not signed in to GitHub Copilot</strong>
      <p style="margin-top: 8px;">You need to authenticate with GitHub. Open a terminal and run:</p>
      <pre style="margin: 8px 0; padding: 8px 12px; background: var(--bg-primary); border-radius: 6px; font-size: 0.9em;">copilot auth login</pre>
      <p>Follow the prompts to sign in with your GitHub account, then click <strong>Retry</strong> below.</p>
    </div>
    <button type="button" class="toggle-btn" style="margin-top: 12px;" onclick={checkAuth}>Retry</button>
  {:else if auth?.authenticated}
    <div class="info-box" style="border-color: var(--accent); display: flex; align-items: center; gap: 12px;">
      {#if auth?.login}
        <img src="https://github.com/{auth.login}.png?size=80" alt="{auth.login}" style="width: 40px; height: 40px; border-radius: 50%; flex-shrink: 0;" />
      {/if}
      <p>Signed in as <strong>{auth?.login ?? 'unknown'}</strong></p>
    </div>

    {#if sortedModels.length > 0}
      <div class="field" style="margin-top: 12px;">
        <span class="label">Default Model</span>
        <select value={selectedModel} onchange={(e) => handleModelChange((e.target as HTMLSelectElement).value)}>
          <option value="">— Select a model —</option>
          {#each sortedModels as model}
            <option value={model.id}>
              {model.name}{model.is_premium ? ` (${model.multiplier}x)` : ' (Included)'}
            </option>
          {/each}
        </select>
        <span class="hint">Model used for prompt enhancement in the popup.</span>
      </div>
    {:else}
      <p class="hint" style="margin-top: 12px;">No models available.</p>
    {/if}

    <div style="margin-top: 12px; display: flex; gap: 8px;">
      <button type="button" class="toggle-btn" onclick={refreshModels}>Refresh Models</button>
      <button type="button" class="toggle-btn" onclick={checkAuth}>Re-check Auth</button>
    </div>
  {:else}
    <button type="button" class="toggle-btn" onclick={checkAuth}>Check Authentication</button>
  {/if}
</div>
