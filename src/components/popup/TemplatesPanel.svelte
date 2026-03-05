<script lang="ts">
  import type { PromptTemplate } from "../../lib/templateStore";

  let {
    open = $bindable(),
    entries,
    onSelect,
  }: {
    open: boolean;
    entries: PromptTemplate[];
    onSelect: (t: PromptTemplate) => void;
  } = $props();
</script>

{#if open}
  <div class="history-panel">
    <div class="history-header">
      <span class="history-title">Templates</span>
      <button class="titlebar-btn" onclick={() => open = false} aria-label="Close templates" title="Close templates">✕</button>
    </div>
    <div class="history-list">
      {#if entries.length === 0}
        <div class="history-empty">No templates yet. Save text from the popup or create templates in Settings.</div>
      {:else}
        {#each entries as t (t.id)}
          <div class="history-entry">
            <button class="history-entry-body" onclick={() => onSelect(t)} title={t.text}>
              <span class="history-text" style="font-weight: 600;">{t.name}</span>
              <span class="history-text" style="font-size: 11px; color: var(--text-secondary);">{t.text.length > 60 ? t.text.slice(0, 60) + '…' : t.text}</span>
            </button>
          </div>
        {/each}
      {/if}
    </div>
  </div>
{/if}
