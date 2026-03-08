<script lang="ts">
  let {
    open = $bindable(),
    editId = null,
    name = $bindable(),
    text = $bindable(),
    namePlaceholder = "e.g. Stand-up notes, Bug report, Feature request…",
    textPlaceholder = "Write the reusable prompt or template text…",
    textLabel = "Template Text",
    textHint = "",
    onSave,
    onClose,
  }: {
    open: boolean;
    editId?: string | null;
    name: string;
    text: string;
    namePlaceholder?: string;
    textPlaceholder?: string;
    textLabel?: string;
    textHint?: string;
    onSave: () => void;
    onClose: () => void;
  } = $props();

  let canSave = $derived(name.trim().length > 0 && text.trim().length > 0);

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && canSave) {
      e.preventDefault();
      onSave();
    }
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="template-modal-backdrop" onclick={onClose}>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="template-modal" onclick={(e) => e.stopPropagation()} onkeydown={handleKeydown}>
      <div class="template-modal-header">
        <h3>{editId ? 'Edit Template' : 'New Template'}</h3>
        <button type="button" class="template-modal-close" onclick={onClose}>✕</button>
      </div>
      <div class="template-modal-body">
        <div class="field">
          <span class="label">Template Name</span>
          <input type="text" placeholder={namePlaceholder} bind:value={name} />
        </div>
        <div class="field">
          <span class="label">{textLabel}</span>
          <textarea class="template-modal-textarea" placeholder={textPlaceholder} bind:value={text} rows="10"></textarea>
          {#if textHint}
            <span class="hint">{textHint}</span>
          {/if}
        </div>
      </div>
      <div class="template-modal-footer">
        <span class="template-modal-shortcut">Ctrl+Enter to save</span>
        <button type="button" class="toggle-btn" onclick={onClose}>Cancel</button>
        <button type="button" class="toggle-btn primary" onclick={onSave} disabled={!canSave}>
          {editId ? 'Save Changes' : 'Add Template'}
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
