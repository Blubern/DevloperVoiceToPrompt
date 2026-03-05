<script lang="ts">
  import { emit } from "@tauri-apps/api/event";
  import { getTemplates, addTemplate, updateTemplate, deleteTemplate, type PromptTemplate } from "../../lib/templateStore";
  import { EVENT_TEMPLATES_UPDATED } from "../../lib/constants";
  import { onMount } from "svelte";

  let templates = $state<PromptTemplate[]>([]);
  let newTemplateName = $state("");
  let newTemplateText = $state("");
  let editingTemplateId = $state<string | null>(null);
  let editTemplateName = $state("");
  let editTemplateText = $state("");
  let deleteConfirmId = $state<string | null>(null);

  onMount(async () => {
    templates = await getTemplates();
  });

  async function handleAddTemplate() {
    if (!newTemplateName.trim() || !newTemplateText.trim()) return;
    await addTemplate(newTemplateName, newTemplateText);
    templates = await getTemplates();
    newTemplateName = "";
    newTemplateText = "";
    await emit(EVENT_TEMPLATES_UPDATED);
  }

  function startEditTemplate(t: PromptTemplate) {
    editingTemplateId = t.id;
    editTemplateName = t.name;
    editTemplateText = t.text;
    deleteConfirmId = null;
  }

  async function saveEditTemplate() {
    if (!editingTemplateId || !editTemplateName.trim() || !editTemplateText.trim()) return;
    await updateTemplate(editingTemplateId, editTemplateName, editTemplateText);
    templates = await getTemplates();
    editingTemplateId = null;
    editTemplateName = "";
    editTemplateText = "";
    await emit(EVENT_TEMPLATES_UPDATED);
  }

  function cancelEditTemplate() {
    editingTemplateId = null;
    editTemplateName = "";
    editTemplateText = "";
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

  <div class="field">
    <span class="label">New Template</span>
    <input type="text" bind:value={newTemplateName} placeholder="Template name..."
      onkeydown={(e) => { if (e.key === 'Enter') e.preventDefault(); }} />
    <textarea class="template-textarea" bind:value={newTemplateText} placeholder="Template text..." rows="3"></textarea>
    <div class="input-row">
      <button type="button" class="toggle-btn" onclick={handleAddTemplate} disabled={!newTemplateName.trim() || !newTemplateText.trim()}>Add Template</button>
    </div>
  </div>

  {#if templates.length === 0}
    <div class="template-empty">No templates yet. Create one above or save text from the popup.</div>
  {:else}
    <div class="template-list">
      {#each templates as t (t.id)}
        <div class="template-item">
          {#if editingTemplateId === t.id}
            <div class="template-edit">
              <input type="text" bind:value={editTemplateName} placeholder="Template name..." />
              <textarea class="template-textarea" bind:value={editTemplateText} placeholder="Template text..." rows="3"></textarea>
              <div class="template-edit-actions">
                <button type="button" class="toggle-btn" onclick={saveEditTemplate} disabled={!editTemplateName.trim() || !editTemplateText.trim()}>Save</button>
                <button type="button" class="toggle-btn" onclick={cancelEditTemplate}>Cancel</button>
              </div>
            </div>
          {:else}
            <div class="template-body">
              <span class="template-name">{t.name}</span>
              <span class="template-preview">{t.text.length > 120 ? t.text.slice(0, 120) + '…' : t.text}</span>
            </div>
            <div class="template-actions">
              <button type="button" class="template-action-btn" onclick={() => startEditTemplate(t)} title="Edit">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              {#if deleteConfirmId === t.id}
                <button type="button" class="template-action-btn delete-confirm" onclick={() => handleDeleteTemplate(t.id)} title="Confirm delete">Yes</button>
                <button type="button" class="template-action-btn" onclick={() => deleteConfirmId = null} title="Cancel">No</button>
              {:else}
                <button type="button" class="template-action-btn delete" onclick={() => deleteConfirmId = t.id} title="Delete">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>
