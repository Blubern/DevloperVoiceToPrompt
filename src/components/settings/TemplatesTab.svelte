<script lang="ts">
  import { emit } from "@tauri-apps/api/event";
  import { getTemplates, addTemplate, updateTemplate, deleteTemplate, type PromptTemplate } from "../../lib/templateStore";
  import { EVENT_TEMPLATES_UPDATED } from "../../lib/constants";
  import { onMount } from "svelte";

  let templates = $state<PromptTemplate[]>([]);
  let deleteConfirmId = $state<string | null>(null);

  // Modal state (shared for add & edit)
  let modalOpen = $state(false);
  let modalEditId = $state<string | null>(null);
  let modalName = $state("");
  let modalText = $state("");
  let modalCanSave = $derived(modalName.trim().length > 0 && modalText.trim().length > 0);

  onMount(async () => {
    templates = await getTemplates();
  });

  function openAddModal() {
    modalEditId = null;
    modalName = "";
    modalText = "";
    modalOpen = true;
  }

  function openEditModal(t: PromptTemplate) {
    modalEditId = t.id;
    modalName = t.name;
    modalText = t.text;
    deleteConfirmId = null;
    modalOpen = true;
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
      await updateTemplate(modalEditId, modalName.trim(), modalText.trim());
    } else {
      await addTemplate(modalName.trim(), modalText.trim());
    }
    templates = await getTemplates();
    closeModal();
    await emit(EVENT_TEMPLATES_UPDATED);
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

  async function handleDeleteTemplate(id: string) {
    await deleteTemplate(id);
    templates = await getTemplates();
    deleteConfirmId = null;
    await emit(EVENT_TEMPLATES_UPDATED);
  }
</script>

<div class="section">
  <h2>Prompt Templates</h2>
  <p class="section-note">Create reusable text templates. You can also save templates from the popup text area.</p>

  {#if templates.length === 0}
    <div class="template-empty">No templates yet. Click <strong>Add Template</strong> below or save text from the popup.</div>
  {:else}
    <div class="template-list">
      {#each templates as t (t.id)}
        <div class="template-item">
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="template-body" onclick={() => openEditModal(t)} style="cursor: pointer;" title="Click to edit">
            <span class="template-name">{t.name}</span>
            <span class="template-preview">{t.text.length > 120 ? t.text.slice(0, 120) + '…' : t.text}</span>
          </div>
          <div class="template-actions">
            <button type="button" class="template-action-btn" onclick={() => openEditModal(t)} title="Edit">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            {#if deleteConfirmId === t.id}
              <button type="button" class="template-action-btn delete-confirm" onclick={() => handleDeleteTemplate(t.id)} title="Confirm delete">Yes</button>
              <button type="button" class="template-action-btn" onclick={() => deleteConfirmId = null} title="Cancel">No</button>
            {:else}
              <button type="button" class="template-action-btn delete" onclick={() => { deleteConfirmId = t.id; }} title="Delete">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              </button>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}

  <div style="margin-top: 12px;">
    <button type="button" class="toggle-btn" onclick={openAddModal}>+ Add Template</button>
  </div>
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
          <input type="text" placeholder="e.g. Stand-up notes, Bug report, Feature request…" bind:value={modalName} />
        </div>
        <div class="field">
          <span class="label">Template Text</span>
          <textarea class="template-modal-textarea" placeholder="Write the reusable prompt or template text that will be loaded into the popup…" bind:value={modalText} rows="10"></textarea>
          <span class="hint">This text will replace the current content in the popup when the template is selected.</span>
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
    box-sizing: border-box;
  }
  .template-modal-textarea:focus { border-color: var(--accent); }
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
  .toggle-btn.primary:hover:not(:disabled) { opacity: 0.9; }
  .toggle-btn.primary:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
