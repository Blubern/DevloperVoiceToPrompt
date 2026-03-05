<script lang="ts">
  import { copilotInit, copilotAuthStatus, copilotListModels, copilotStop, type CopilotAuthStatus, type CopilotModel } from "../../lib/copilotStore";
  import { getEnhancerTemplates, addEnhancerTemplate, updateEnhancerTemplate, deleteEnhancerTemplate, type EnhancerTemplate } from "../../lib/enhancerTemplateStore";
  import { EVENT_ENHANCER_TEMPLATES_UPDATED } from "../../lib/constants";
  import { emit } from "@tauri-apps/api/event";
  import ShortcutRecorder from "../ShortcutRecorder.svelte";
  import { onMount } from "svelte";

  let {
    copilotEnabled = $bindable(),
    copilotSelectedModel = $bindable(),
    copilotSelectedEnhancer = $bindable(),
    promptEnhancerShortcut = $bindable(),
  }: {
    copilotEnabled: boolean;
    copilotSelectedModel: string;
    copilotSelectedEnhancer: string;
    promptEnhancerShortcut: string;
  } = $props();

  let copilotAuth = $state<CopilotAuthStatus | null>(null);
  let copilotModels = $state<CopilotModel[]>([]);
  let copilotLoading = $state(false);
  let copilotError = $state("");
  let copilotInitialized = $state(false);
  let copilotNeedsCli = $state(false);
  let copilotNeedsLogin = $state(false);

  // Enhancer template CRUD state
  let enhancerTemplates = $state<EnhancerTemplate[]>([]);
  let newTemplateName = $state("");
  let newTemplateText = $state("");
  let editingId = $state<string | null>(null);
  let editName = $state("");
  let editText = $state("");
  let deleteConfirmId = $state<string | null>(null);

  let sortedModels = $derived([...copilotModels].sort((a, b) => a.name.localeCompare(b.name)));

  onMount(async () => {
    enhancerTemplates = await getEnhancerTemplates();
  });

  // Auto-connect when toggled on
  $effect(() => {
    if (copilotEnabled && !copilotInitialized && !copilotLoading && !copilotNeedsCli && !copilotNeedsLogin) {
      connectCopilot();
    }
  });

  async function connectCopilot() {
    copilotLoading = true; copilotError = ''; copilotNeedsCli = false; copilotNeedsLogin = false;
    try {
      await copilotInit(); copilotInitialized = true;
      copilotAuth = await copilotAuthStatus();
      if (copilotAuth?.authenticated) { copilotModels = await copilotListModels(); }
      else { copilotNeedsLogin = true; }
    } catch (e: any) {
      copilotInitialized = false;
      const msg = String(e); const msgLower = msg.toLowerCase();
      if (msgLower.includes('not found') || msgLower.includes('no such file') || msgLower.includes('os error 2') || msgLower.includes('program not found')) { copilotNeedsCli = true; }
      else { copilotError = msg; }
    } finally { copilotLoading = false; }
  }

  async function retryAuth() {
    copilotLoading = true; copilotError = ''; copilotNeedsLogin = false;
    try {
      copilotAuth = await copilotAuthStatus();
      if (copilotAuth?.authenticated) { copilotModels = await copilotListModels(); }
      else { copilotNeedsLogin = true; }
    } catch (e: any) { copilotError = String(e); copilotNeedsLogin = true; }
    finally { copilotLoading = false; }
  }

  async function refreshModels() {
    copilotLoading = true; copilotError = '';
    try { copilotModels = await copilotListModels(); } catch (e: any) { copilotError = String(e); }
    finally { copilotLoading = false; }
  }

  async function disconnect() {
    copilotLoading = true;
    try { await copilotStop(); copilotInitialized = false; copilotAuth = null; copilotModels = []; copilotNeedsLogin = false; }
    catch (e: any) { copilotError = String(e); } finally { copilotLoading = false; }
  }

  async function handleAddTemplate() {
    const name = newTemplateName.trim();
    const text = newTemplateText.trim();
    if (!name || !text) return;
    await addEnhancerTemplate(name, text);
    enhancerTemplates = await getEnhancerTemplates();
    newTemplateName = "";
    newTemplateText = "";
    await emit(EVENT_ENHANCER_TEMPLATES_UPDATED);
  }

  function startEdit(t: EnhancerTemplate) {
    editingId = t.id;
    editName = t.name;
    editText = t.text;
    deleteConfirmId = null;
  }

  async function saveEdit() {
    if (!editingId || !editName.trim() || !editText.trim()) return;
    await updateEnhancerTemplate(editingId, editName, editText);
    enhancerTemplates = await getEnhancerTemplates();
    editingId = null;
    await emit(EVENT_ENHANCER_TEMPLATES_UPDATED);
  }

  function cancelEdit() {
    editingId = null;
  }

  async function confirmDelete(id: string) {
    await deleteEnhancerTemplate(id);
    enhancerTemplates = await getEnhancerTemplates();
    deleteConfirmId = null;
    await emit(EVENT_ENHANCER_TEMPLATES_UPDATED);
  }
</script>

<div class="section">
  <h2>GitHub Copilot</h2>

  <label class="field toggle-field">
    <span class="label">Enable Copilot Integration</span>
    <div class="toggle-row">
      <input type="checkbox" class="toggle-checkbox" bind:checked={copilotEnabled} />
      <span class="toggle-label">{copilotEnabled ? 'On' : 'Off'}</span>
    </div>
    <span class="hint">Connect to GitHub Copilot on startup to enhance your voice transcriptions into better prompts.</span>
  </label>
</div>

{#if copilotEnabled}
  <!-- Connection section -->
  <div class="section" style="margin-top: 12px;">
    <h2>Connection</h2>

    {#if copilotError}
      <div class="message error" style="margin-bottom: 12px;">{copilotError}</div>
    {/if}

    {#if copilotLoading}
      <p class="hint">Connecting...</p>
    {:else if copilotNeedsCli}
      <div class="info-box">
        <strong>GitHub Copilot CLI not found</strong>
        <p style="margin-top: 8px;">The GitHub Copilot CLI is required to use this feature. To install it:</p>
        <ol style="margin: 8px 0 0 20px; line-height: 1.8;">
          <li>Run <code>winget install GitHub.Copilot</code> (Windows) or see <a href="https://docs.github.com/en/copilot/managing-copilot/configure-personal-settings/installing-github-copilot-in-the-cli" target="_blank" rel="noopener">install docs</a></li>
          <li>Restart your terminal so <code>copilot</code> is on your PATH</li>
          <li>Come back here and click <strong>Retry</strong></li>
        </ol>
      </div>
      <button type="button" class="toggle-btn" style="margin-top: 12px;" onclick={() => { copilotNeedsCli = false; copilotError = ''; connectCopilot(); }}>Retry</button>
    {:else if copilotNeedsLogin}
      <div class="info-box">
        <strong>Not signed in to GitHub Copilot</strong>
        <p style="margin-top: 8px;">You need to authenticate with GitHub. Open a terminal and run:</p>
        <pre style="margin: 8px 0; padding: 8px 12px; background: var(--bg-primary); border-radius: 6px; font-size: 0.9em;">copilot auth login</pre>
        <p>Follow the prompts to sign in with your GitHub account, then click <strong>Retry</strong> below.</p>
      </div>
      <button type="button" class="toggle-btn" style="margin-top: 12px;" onclick={retryAuth}>Retry</button>
    {:else if !copilotInitialized}
      <button type="button" class="toggle-btn" onclick={connectCopilot}>Connect to GitHub Copilot</button>
    {:else}
      <div class="info-box" style="border-color: var(--accent-primary); display: flex; align-items: center; gap: 12px;">
        {#if copilotAuth?.login}
          <img src="https://github.com/{copilotAuth.login}.png?size=80" alt="{copilotAuth.login}" style="width: 40px; height: 40px; border-radius: 50%; flex-shrink: 0;" />
        {/if}
        <p>Signed in as <strong>{copilotAuth?.login ?? 'unknown'}</strong></p>
      </div>

      <!-- Model selection -->
      {#if sortedModels.length > 0}
        <div class="field" style="margin-top: 12px;">
          <span class="label">Default Model</span>
          <select bind:value={copilotSelectedModel}>
            <option value="">— Select a model —</option>
            {#each sortedModels as model}
              <option value={model.id}>
                {model.name}{model.is_premium ? ` (${model.multiplier}x)` : ' (Included)'}
              </option>
            {/each}
          </select>
          <span class="hint">Model used for prompt enhancement in the popup. Sorted alphabetically.</span>
        </div>
      {:else}
        <p class="hint" style="margin-top: 12px;">No models available.</p>
      {/if}

      <div style="margin-top: 12px; display: flex; gap: 8px;">
        <button type="button" class="toggle-btn" onclick={refreshModels}>Refresh Models</button>
        <button type="button" class="toggle-btn" onclick={disconnect}>Disconnect</button>
      </div>
    {/if}
  </div>

  <!-- Prompt Enhancer Templates section -->
  <div class="section" style="margin-top: 12px;">
    <h2>Prompt Enhancer Templates</h2>
    <p class="hint" style="margin-bottom: 10px;">Instructions sent to the AI model to enhance your transcribed text.</p>

    <!-- Template list first -->
    {#if enhancerTemplates.length > 0}
      <div class="template-list" style="margin-bottom: 12px;">
        {#each enhancerTemplates as t (t.id)}
          {#if editingId === t.id}
            <div class="template-item">
              <div class="template-edit">
                <input type="text" bind:value={editName} placeholder="Template name" />
                <textarea class="template-textarea" bind:value={editText} rows="4" placeholder="Instructions..."></textarea>
                <div class="template-edit-actions">
                  <button type="button" class="toggle-btn" onclick={saveEdit} disabled={!editName.trim() || !editText.trim()}>Save</button>
                  <button type="button" class="toggle-btn" onclick={cancelEdit}>Cancel</button>
                </div>
              </div>
            </div>
          {:else}
            <div class="template-item">
              <div class="template-body">
                <span class="template-name">{t.name}</span>
                <span class="template-preview">{t.text}</span>
              </div>
              <div class="template-actions">
                <button type="button" class="template-action-btn" onclick={() => startEdit(t)} title="Edit">✎</button>
                {#if deleteConfirmId === t.id}
                  <button type="button" class="template-action-btn delete-confirm" onclick={() => confirmDelete(t.id)} title="Confirm delete">✓</button>
                {:else}
                  <button type="button" class="template-action-btn delete" onclick={() => deleteConfirmId = t.id} title="Delete">✕</button>
                {/if}
              </div>
            </div>
          {/if}
        {/each}
      </div>
    {/if}

    <!-- Add new template -->
    <div class="field">
      <span class="label">New Template</span>
      <input type="text" placeholder="Template name" bind:value={newTemplateName} />
    </div>
    <div class="field">
      <span class="label">Instructions</span>
      <textarea
        class="template-textarea"
        placeholder="Write the instructions for how the AI should enhance the transcribed text..."
        bind:value={newTemplateText}
        rows="3"
      ></textarea>
    </div>
    <button type="button" class="toggle-btn" onclick={handleAddTemplate} disabled={!newTemplateName.trim() || !newTemplateText.trim()}>
      Add Template
    </button>

    {#if enhancerTemplates.length > 0}
      <div class="field" style="margin-top: 12px;">
        <span class="label">Default Enhancer Template</span>
        <select bind:value={copilotSelectedEnhancer}>
          <option value="">— None —</option>
          {#each enhancerTemplates as t}
            <option value={t.id}>{t.name}</option>
          {/each}
        </select>
        <span class="hint">Pre-selected enhancer template when opening the popup.</span>
      </div>
    {/if}
  </div>

  <!-- Shortcut section -->
  <div class="section" style="margin-top: 12px;">
    <h2>Shortcut</h2>
    <div class="field">
      <span class="label">Enhance Prompt</span>
      <ShortcutRecorder bind:value={promptEnhancerShortcut} />
      <span class="hint">Keyboard shortcut to trigger prompt enhancement in the popup window.</span>
    </div>
  </div>
{/if}
