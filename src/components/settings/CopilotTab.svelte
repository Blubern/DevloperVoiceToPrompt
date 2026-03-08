<script lang="ts">
  import { copilotInit, copilotAuthStatus, copilotListModels, copilotStop, type CopilotAuthStatus, type CopilotModel } from "../../lib/copilotStore";
  import { getEnhancerTemplates, addEnhancerTemplate, updateEnhancerTemplate, deleteEnhancerTemplate, resetEnhancerTemplates, type EnhancerTemplate } from "../../lib/enhancerTemplateStore";
  import { EVENT_ENHANCER_TEMPLATES_UPDATED } from "../../lib/constants";
  import { emit } from "@tauri-apps/api/event";
  import ShortcutRecorder from "../ShortcutRecorder.svelte";
  import TemplateEditorModal from "./TemplateEditorModal.svelte";
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
  let resetConfirm = $state(false);

  // Modal state for add/edit
  let modalOpen = $state(false);
  let modalEditId = $state<string | null>(null);
  let modalName = $state("");
  let modalText = $state("");

  let sortedModels = $derived([...copilotModels].sort((a, b) => a.name.localeCompare(b.name)));

  onMount(async () => {
    enhancerTemplates = await getEnhancerTemplates();
    // Auto-select first template if none is selected
    if (!copilotSelectedEnhancer && enhancerTemplates.length > 0) {
      copilotSelectedEnhancer = enhancerTemplates[0].id;
    }
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
    const trimmedName = modalName.trim();
    const trimmedText = modalText.trim();
    if (!trimmedName || !trimmedText) return;
    if (modalEditId) {
      await updateEnhancerTemplate(modalEditId, trimmedName, trimmedText);
    } else {
      await addEnhancerTemplate(trimmedName, trimmedText);
    }
    enhancerTemplates = await getEnhancerTemplates();
    closeModal();
    await emit(EVENT_ENHANCER_TEMPLATES_UPDATED);
  }

  async function confirmDelete(id: string) {
    await deleteEnhancerTemplate(id);
    enhancerTemplates = await getEnhancerTemplates();
    deleteConfirmId = null;
    await emit(EVENT_ENHANCER_TEMPLATES_UPDATED);
  }

  async function handleResetTemplates() {
    enhancerTemplates = await resetEnhancerTemplates();
    copilotSelectedEnhancer = "";
    resetConfirm = false;
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

    <div class="speech-notice" style="margin-bottom: 12px;">
      <div class="notice-icon">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
      </div>
      <div class="notice-content">
        <strong>GitHub Copilot CLI Required</strong>
        <p>This feature requires the <a href="https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli" target="_blank" rel="noopener noreferrer" class="notice-link">GitHub Copilot CLI</a> to be installed and on your PATH and logged in. The preview version of <code>copilot-cli</code> is not supported — make sure you have the stable release.</p>
      </div>
    </div>

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

    <div style="display: flex; gap: 8px;">
      <button type="button" class="toggle-btn" onclick={openAddModal}>
        + Add Template
      </button>
      {#if resetConfirm}
        <button type="button" class="toggle-btn danger" onclick={handleResetTemplates}>
          Confirm Reset
        </button>
        <button type="button" class="toggle-btn" onclick={() => resetConfirm = false}>
          Cancel
        </button>
      {:else}
        <button type="button" class="toggle-btn" onclick={() => resetConfirm = true}>
          Reset to Defaults
        </button>
      {/if}
    </div>
    {#if resetConfirm}
      <p class="hint" style="color: var(--error); margin-top: 6px;">This will replace all your templates with the defaults. Custom templates will be lost.</p>
    {/if}

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

  <TemplateEditorModal
    bind:open={modalOpen}
    editId={modalEditId}
    bind:name={modalName}
    bind:text={modalText}
    namePlaceholder="e.g. Developer Prompt Optimizer"
    textPlaceholder="Write the instructions for how the AI should enhance the transcribed text..."
    textLabel="Instructions"
    textHint="These instructions are sent as the system prompt to the AI model when enhancing your transcribed text."
    onSave={handleModalSave}
    onClose={closeModal}
  />

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
  .toggle-btn.danger {
    color: var(--error);
    border-color: var(--error);
  }
  .toggle-btn.danger:hover {
    background: var(--error-bg);
  }
</style>
