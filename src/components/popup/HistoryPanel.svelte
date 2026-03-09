<script lang="ts">
  import { writeText } from "@tauri-apps/plugin-clipboard-manager";
  import { formatRelativeTime, type HistoryEntry } from "../../lib/historyStore";

  let {
    open = $bindable(),
    entries,
    search = $bindable(),
    onInsert,
    onDelete,
  }: {
    open: boolean;
    entries: HistoryEntry[];
    search: string;
    onInsert: (text: string) => void;
    onDelete: (id: string) => void;
  } = $props();

  let filteredEntries = $derived(
    search.trim()
      ? entries.filter(e => {
          const q = search.trim().toLowerCase();
          return e.text.toLowerCase().includes(q) || (e.input_reason?.toLowerCase().includes(q) ?? false);
        })
      : entries
  );

  async function copyEntry(text: string) {
    await writeText(text);
  }
</script>

{#if open}
  <div class="history-panel">
    <div class="history-header">
      <span class="history-title">History</span>
      <button class="titlebar-btn" onclick={() => open = false} aria-label="Close history" title="Close history">✕</button>
    </div>
    <div class="history-search">
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input class="history-search-input" type="text" placeholder="Search history..." bind:value={search} />
      {#if search}
        <button class="history-search-clear" onclick={() => search = ""} aria-label="Clear search">✕</button>
      {/if}
    </div>
    <div class="history-list">
      {#if filteredEntries.length === 0}
        <div class="history-empty">{entries.length === 0 ? 'No history yet' : 'No matches'}</div>
      {:else}
        {#each filteredEntries as entry}
          <div class="history-entry">
            <button class="history-entry-body" onclick={() => onInsert(entry.text)} title={entry.input_reason ? `[MCP] ${entry.input_reason}\n\n${entry.text}` : entry.text}>
              {#if entry.input_reason}
                <span class="history-mcp-row">
                  <span class="history-mcp-badge">MCP</span>
                  <span class="history-mcp-reason" title={entry.input_reason}>{entry.input_reason}</span>
                </span>
              {/if}
              <span class="history-text">{entry.text.length > 80 ? entry.text.slice(0, 80) + '…' : entry.text}</span>
              <span class="history-time">{formatRelativeTime(entry.timestamp)}</span>
            </button>
            <div class="history-entry-actions">
              <button class="history-action-btn" onclick={() => onInsert(entry.text)} aria-label="Insert" title="Insert into text">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
              </button>
              <button class="history-action-btn" onclick={() => copyEntry(entry.text)} aria-label="Copy" title="Copy to clipboard">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              </button>
              <button class="history-action-btn delete" onclick={() => onDelete(entry.id)} aria-label="Delete" title="Delete">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              </button>
            </div>
          </div>
        {/each}
      {/if}
    </div>
  </div>
{/if}
