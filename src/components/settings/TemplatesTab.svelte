<script lang="ts">
  import { emit } from "@tauri-apps/api/event";
  import { getTemplates, addTemplate, updateTemplate, deleteTemplate, type PromptTemplate } from "../../lib/templateStore";
  import { EVENT_TEMPLATES_UPDATED } from "../../lib/constants";
  import { onMount } from "svelte";
  import TemplateEditorModal from "./TemplateEditorModal.svelte";

  let templates = $state<PromptTemplate[]>([]);
  let deleteConfirmId = $state<string | null>(null);

  // Modal state (shared for add & edit)
  let modalOpen = $state(false);
  let modalEditId = $state<string | null>(null);
  let modalName = $state("");
  let modalText = $state("");

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
    const trimmedName = modalName.trim();
    const trimmedText = modalText.trim();
    if (!trimmedName || !trimmedText) return;
    if (modalEditId) {
      await updateTemplate(modalEditId, trimmedName, trimmedText);
    } else {
      await addTemplate(trimmedName, trimmedText);
    }
    templates = await getTemplates();
    closeModal();
    await emit(EVENT_TEMPLATES_UPDATED);
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

<TemplateEditorModal
  bind:open={modalOpen}
  editId={modalEditId}
  bind:name={modalName}
  bind:text={modalText}
  namePlaceholder="e.g. Stand-up notes, Bug report, Feature request…"
  textPlaceholder="Write the reusable prompt or template text that will be loaded into the popup…"
  textHint="This text will replace the current content in the popup when the template is selected."
  onSave={handleModalSave}
  onClose={closeModal}
/>
