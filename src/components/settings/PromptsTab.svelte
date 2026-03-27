<script lang="ts">
  import { getEnhancerTemplates, addEnhancerTemplate, updateEnhancerTemplate, deleteEnhancerTemplate, resetEnhancerTemplates, type EnhancerTemplate } from "../../lib/enhancerTemplateStore";
  import { EVENT_ENHANCER_TEMPLATES_UPDATED } from "../../lib/constants";
  import { emit } from "@tauri-apps/api/event";
  import ShortcutRecorder from "../ShortcutRecorder.svelte";
  import TemplateEditorModal from "./TemplateEditorModal.svelte";
  import { onMount } from "svelte";

  let {
    aiSelectedEnhancer = $bindable(),
    promptEnhancerShortcut = $bindable(),
  }: {
    aiSelectedEnhancer: string;
    promptEnhancerShortcut: string;
  } = $props();

  let enhancerTemplates = $state<EnhancerTemplate[]>([]);
  let deleteConfirmId = $state<string | null>(null);
  let resetConfirm = $state(false);

  // Modal state for add/edit
  let modalOpen = $state(false);
  let modalEditId = $state<string | null>(null);
  let modalName = $state("");
  let modalText = $state("");

  onMount(async () => {
    enhancerTemplates = await getEnhancerTemplates();
    if (!aiSelectedEnhancer && enhancerTemplates.length > 0) {
      aiSelectedEnhancer = enhancerTemplates[0].id;
    }
  });

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
    try {
      if (modalEditId) {
        await updateEnhancerTemplate(modalEditId, trimmedName, trimmedText);
      } else {
        await addEnhancerTemplate(trimmedName, trimmedText);
      }
      enhancerTemplates = await getEnhancerTemplates();
      closeModal();
      await emit(EVENT_ENHANCER_TEMPLATES_UPDATED);
    } catch (e) {
      console.error("PromptsTab: failed to save enhancer template:", e);
    }
  }

  async function confirmDelete(id: string) {
    try {
      await deleteEnhancerTemplate(id);
      enhancerTemplates = await getEnhancerTemplates();
      deleteConfirmId = null;
      await emit(EVENT_ENHANCER_TEMPLATES_UPDATED);
    } catch (e) {
      console.error("PromptsTab: failed to delete enhancer template:", e);
    }
  }

  async function handleResetTemplates() {
    try {
      enhancerTemplates = await resetEnhancerTemplates();
      aiSelectedEnhancer = "";
      resetConfirm = false;
      await emit(EVENT_ENHANCER_TEMPLATES_UPDATED);
    } catch (e) {
      console.error("PromptsTab: failed to reset enhancer templates:", e);
    }
  }
</script>

<div class="section">
  <h2>Prompt Enhancer Templates</h2>
  <p class="hint" style="margin-bottom: 10px;">Instructions sent to the AI model to enhance your transcribed text. These work with any AI provider.</p>

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
      <select bind:value={aiSelectedEnhancer}>
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

<div class="section" style="margin-top: 12px;">
  <h2>Shortcut</h2>
  <div class="field">
    <span class="label">Enhance Prompt</span>
    <ShortcutRecorder bind:value={promptEnhancerShortcut} />
    <span class="hint">Keyboard shortcut to trigger prompt enhancement in the popup window.</span>
  </div>
</div>

<style>
  .toggle-btn.danger {
    color: var(--error);
    border-color: var(--error);
  }
  .toggle-btn.danger:hover {
    background: var(--error-bg);
  }
</style>
