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
    copilotDeleteSessions = $bindable(),
    promptEnhancerShortcut = $bindable(),
  }: {
    copilotEnabled: boolean;
    copilotSelectedModel: string;
    copilotSelectedEnhancer: string;
    copilotDeleteSessions: boolean;
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
  let deleteConfirmId = $state<string | null>(null);

  // Modal state for add/edit
  let modalOpen = $state(false);
  let modalEditId = $state<string | null>(null); // null = adding new, string = editing existing
  let modalName = $state("");
  let modalText = $state("");
  let modalCanSave = $derived(modalName.trim().length > 0 && modalText.trim().length > 0);

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

  function openAddModal() {
    modalEditId = null;
    modalName = "";
    modalText = "";
    modalOpen = true;
  }

  function openEditModal(t: EnhancerTemplate) {
    modalEditId = t.id;
    modalName = t.name;
    modalText = t.text;
    modalOpen = true;
    deleteConfirmId = null;
  }

  function closeModal() {
    modalOpen = false;
    modalEditId = null;
    modalName = "";
    modalText = "";
  }

  async function handleModalSave() {
    if (!modalCanSave) return;
    if (modalEditId) {
      await updateEnhancerTemplate(modalEditId, modalName, modalText);
    } else {
      await addEnhancerTemplate(modalName, modalText);
    }
    enhancerTemplates = await getEnhancerTemplates();
    closeModal();
    await emit(EVENT_ENHANCER_TEMPLATES_UPDATED);
  }

  function handleModalKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeModal();
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && modalCanSave) {
      e.preventDefault();
      handleModalSave();
    }
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

    <!-- Template list -->
    {#if enhancerTemplates.length > 0}
      <div class="template-list" style="margin-bottom: 12px;">
        {#each enhancerTemplates as t (t.id)}
          <div class="template-item">
            <div class="template-body" onclick={() => openEditModal(t)} role="button" tabindex="0" onkeydown={(e) => { if (e.key === 'Enter') openEditModal(t); }} style="cursor: pointer;">
              <span class="template-name">{t.name}</span>
              <span class="template-preview">{t.text}</span>
            </div>
            <div class="template-actions">
              <button type="button" class="template-action-btn" onclick={() => openEditModal(t)} title="Edit">✎</button>
              {#if deleteConfirmId === t.id}
                <button type="button" class="template-action-btn delete-confirm" onclick={() => confirmDelete(t.id)} title="Confirm delete">✓</button>
              {:else}
                <button type="button" class="template-action-btn delete" onclick={() => deleteConfirmId = t.id} title="Delete">✕</button>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}

    <button type="button" class="toggle-btn" onclick={openAddModal}>
      + Add Template
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

  <!-- Template Editor Modal -->
  {#if modalOpen}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="template-modal-backdrop" onclick={closeModal}>
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="template-modal" onclick={(e) => e.stopPropagation()} onkeydown={handleModalKeydown}>
        <div class="template-modal-header">
          <h3>{modalEditId ? 'Edit Template' : 'New Template'}</h3>
          <button type="button" class="template-modal-close" onclick={closeModal}>✕</button>
        </div>
        <div class="template-modal-body">
          <div class="field">
            <span class="label">Template Name</span>
            <input
              type="text"
              placeholder="e.g. Developer Prompt Optimizer"
              bind:value={modalName}
            />
          </div>
          <div class="field">
            <span class="label">Instructions</span>
            <textarea
              class="template-modal-textarea"
              placeholder="Write the instructions for how the AI should enhance the transcribed text..."
              bind:value={modalText}
              rows="10"
            ></textarea>
            <span class="hint">These instructions are sent as the system prompt to the AI model when enhancing your transcribed text.</span>
          </div>
        </div>
        <div class="template-modal-footer">
          <span class="template-modal-shortcut">Ctrl+Enter to save</span>
          <button type="button" class="toggle-btn" onclick={closeModal}>Cancel</button>
          <button type="button" class="toggle-btn primary" onclick={handleModalSave} disabled={!modalCanSave}>
            {modalEditId ? 'Save Changes' : 'Add Template'}
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Shortcut section -->
  <div class="section" style="margin-top: 12px;">
    <h2>Shortcut</h2>
    <div class="field">
      <span class="label">Enhance Prompt</span>
      <ShortcutRecorder bind:value={promptEnhancerShortcut} />
      <span class="hint">Keyboard shortcut to trigger prompt enhancement in the popup window.</span>
    </div>
  </div>

  <!-- Privacy section -->
  <div class="section" style="margin-top: 12px;">
    <h2>Privacy</h2>
    <label class="field toggle-field">
      <span class="label">Delete Sessions After Enhancement</span>
      <div class="toggle-row">
        <input type="checkbox" class="toggle-checkbox" bind:checked={copilotDeleteSessions} />
        <span class="toggle-label">{copilotDeleteSessions ? 'On' : 'Off'}</span>
      </div>
      <span class="hint">When enabled, enhancement sessions are deleted from the Copilot CLI after use so they don't appear in VS Code's Copilot Chat or other tools sharing the same CLI. Disable to keep session history.</span>
    </label>
  </div>
{/if}

<style>
  .template-modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
    backdrop-filter: blur(2px);
  }

  .template-modal {
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 12px;
    width: 560px;
    max-width: 90vw;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.3);
  }

  .template-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px 12px;
    border-bottom: 1px solid var(--border);
  }

  .template-modal-header h3 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .template-modal-close {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 16px;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 4px;
  }
  .template-modal-close:hover {
    background: var(--surface);
    color: var(--text-primary);
  }

  .template-modal-body {
    padding: 16px 20px;
    flex: 1;
    overflow-y: auto;
  }

  .template-modal-textarea {
    width: 100%;
    padding: 10px 12px;
    background: var(--input-bg);
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 13px;
    font-family: inherit;
    resize: vertical;
    outline: none;
    line-height: 1.6;
    min-height: 180px;
  }
  .template-modal-textarea:focus {
    border-color: var(--accent);
  }

  .template-modal-footer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 20px 16px;
    border-top: 1px solid var(--border);
    justify-content: flex-end;
  }

  .template-modal-shortcut {
    font-size: 11px;
    color: var(--text-muted);
    margin-right: auto;
  }

  .toggle-btn.primary {
    background: var(--accent);
    color: var(--bg-primary);
    border-color: var(--accent);
  }
  .toggle-btn.primary:hover:not(:disabled) {
    opacity: 0.9;
  }
  .toggle-btn.primary:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
