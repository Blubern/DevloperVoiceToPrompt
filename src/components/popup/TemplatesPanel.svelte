<script lang="ts">
  import { emit } from "@tauri-apps/api/event";
  import { updateTemplate, deleteTemplate, type PromptTemplate } from "../../lib/templateStore";
  import { EVENT_TEMPLATES_UPDATED } from "../../lib/constants";

  let {
    open = $bindable(),
    entries,
    onSelect,
    onSave,
    hasText = false,
    saveTriggered = $bindable(false),
  }: {
    open: boolean;
    entries: PromptTemplate[];
    onSelect: (t: PromptTemplate) => void;
    onSave?: (name: string) => void;
    hasText?: boolean;
    saveTriggered?: boolean;
  } = $props();

  let editingId = $state<string | null>(null);
  let editName = $state("");
  let editText = $state("");
  let deleteConfirmId = $state<string | null>(null);
  let saveMode = $state(false);
  let saveName = $state("");

  $effect(() => {
    if (saveTriggered) {
      saveMode = true;
      saveName = "";
      editingId = null;
      deleteConfirmId = null;
      saveTriggered = false;
    }
  });

  function startEdit(t: PromptTemplate) {
    editingId = t.id;
    editName = t.name;
    editText = t.text;
    deleteConfirmId = null;
    saveMode = false;
  }

  async function confirmEdit() {
    if (!editingId || !editName.trim() || !editText.trim()) return;
    await updateTemplate(editingId, editName.trim(), editText.trim());
    editingId = null;
    editName = "";
    editText = "";
    await emit(EVENT_TEMPLATES_UPDATED);
  }

  function cancelEdit() {
    editingId = null;
    editName = "";
    editText = "";
  }

  async function confirmDelete(id: string) {
    await deleteTemplate(id);
    deleteConfirmId = null;
    await emit(EVENT_TEMPLATES_UPDATED);
  }

  function handleSave() {
    const name = saveName.trim();
    if (!name || !onSave) return;
    onSave(name);
    saveMode = false;
    saveName = "";
  }
</script>

{#if open}
  <div class="history-panel">
    <div class="history-header">
      <span class="history-title">Templates</span>
      <div style="display: flex; align-items: center; gap: 4px;">
        {#if hasText && !saveMode}
          <button class="titlebar-btn" onclick={() => { saveMode = true; saveName = ""; editingId = null; deleteConfirmId = null; }} title="Save current text as template">+</button>
        {/if}
        <button class="titlebar-btn" onclick={() => open = false} aria-label="Close templates" title="Close templates">✕</button>
      </div>
    </div>
    {#if saveMode}
      <div class="tpl-save-row">
        <input
          class="tpl-input"
          type="text"
          placeholder="Template name..."
          bind:value={saveName}
          onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSave(); } if (e.key === 'Escape') { saveMode = false; } }}
        />
        <button class="history-action-btn" onclick={handleSave} disabled={!saveName.trim()} title="Save template">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        </button>
        <button class="history-action-btn" onclick={() => saveMode = false} title="Cancel">✕</button>
      </div>
    {/if}
    <div class="history-list">
      {#if entries.length === 0}
        <div class="history-empty">No templates yet. Save text from the popup or create templates in Settings.</div>
      {:else}
        {#each entries as t (t.id)}
          <div class="history-entry" class:tpl-editing={editingId === t.id}>
            {#if editingId === t.id}
              <div class="tpl-edit-form">
                <input class="tpl-input" type="text" bind:value={editName} placeholder="Template name..."
                  onkeydown={(e) => { if (e.key === 'Escape') cancelEdit(); }} />
                <textarea class="tpl-textarea" bind:value={editText} placeholder="Template text..." rows="3"></textarea>
                <div class="tpl-edit-actions">
                  <button class="tpl-action-btn tpl-save-btn" onclick={confirmEdit} disabled={!editName.trim() || !editText.trim()} title="Save">
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    Save
                  </button>
                  <button class="tpl-action-btn" onclick={cancelEdit} title="Cancel">Cancel</button>
                </div>
              </div>
            {:else}
              <button class="history-entry-body" onclick={() => onSelect(t)} title={t.text}>
                <span class="history-text" style="font-weight: 600;">{t.name}</span>
                <span class="history-text" style="font-size: 11px; color: var(--text-secondary);">{t.text.length > 60 ? t.text.slice(0, 60) + '…' : t.text}</span>
              </button>
              <div class="history-entry-actions">
                <button class="history-action-btn" onclick={() => startEdit(t)} title="Edit">
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>
                {#if deleteConfirmId === t.id}
                  <button class="history-action-btn" onclick={() => confirmDelete(t.id)} title="Confirm delete" style="font-size: 9px; color: var(--error);">Yes</button>
                  <button class="history-action-btn" onclick={() => deleteConfirmId = null} title="Cancel" style="font-size: 9px;">No</button>
                {:else}
                  <button class="history-action-btn delete" onclick={() => { deleteConfirmId = t.id; editingId = null; }} title="Delete">
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                  </button>
                {/if}
              </div>
            {/if}
          </div>
        {/each}
      {/if}
    </div>
  </div>
{/if}

<style>
  .tpl-save-row {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 8px;
    border-bottom: 1px solid var(--border);
  }

  .tpl-input {
    flex: 1;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text-primary);
    font-size: 11px;
    font-family: inherit;
    padding: 4px 6px;
    outline: none;
    min-width: 0;
  }

  .tpl-input:focus {
    border-color: var(--accent);
  }

  .tpl-editing {
    flex-direction: column;
    align-items: stretch;
  }

  .tpl-edit-form {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px 8px;
    width: 100%;
    box-sizing: border-box;
  }

  .tpl-textarea {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text-primary);
    font-size: 11px;
    font-family: inherit;
    padding: 4px 6px;
    outline: none;
    resize: vertical;
    min-height: 52px;
  }

  .tpl-textarea:focus {
    border-color: var(--accent);
  }

  .tpl-edit-actions {
    display: flex;
    gap: 4px;
    justify-content: flex-end;
  }

  .tpl-action-btn {
    display: flex;
    align-items: center;
    gap: 3px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 10px;
    font-family: inherit;
    padding: 3px 7px;
    transition: background 0.1s, color 0.1s;
  }

  .tpl-action-btn:hover:not(:disabled) {
    background: var(--surface-hover);
    color: var(--text-primary);
  }

  .tpl-action-btn:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .tpl-save-btn {
    color: var(--accent);
    border-color: var(--accent);
  }

  .tpl-save-btn:hover:not(:disabled) {
    background: var(--accent);
    color: var(--bg-primary);
  }
</style>
