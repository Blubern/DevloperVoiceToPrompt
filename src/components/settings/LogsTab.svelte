<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { onMount } from "svelte";

  let logContent = $state("");
  let logPath = $state("");
  let loading = $state(false);
  let filterText = $state("");
  let filterLevel = $state<"all" | "info" | "warn" | "error">("all");

  let filteredLines = $derived.by(() => {
    if (!logContent) return [];
    const lines = logContent.split("\n").filter(Boolean);
    return lines.filter((line) => {
      if (filterLevel !== "all") {
        const upper = filterLevel.toUpperCase();
        if (!line.toUpperCase().includes(upper)) return false;
      }
      if (filterText.trim()) {
        if (!line.toLowerCase().includes(filterText.trim().toLowerCase())) return false;
      }
      return true;
    });
  });

  async function loadLogs() {
    loading = true;
    try {
      logContent = await invoke<string>("get_logs", { maxLines: 1000 });
    } catch (e) {
      logContent = `Error loading logs: ${e}`;
    } finally {
      loading = false;
    }
  }

  async function clearLogs() {
    try {
      await invoke("clear_logs");
      logContent = "";
    } catch (e) {
      logContent = `Error clearing logs: ${e}`;
    }
  }

  async function loadLogPath() {
    try {
      logPath = await invoke<string>("get_log_path");
    } catch {
      logPath = "";
    }
  }

  function levelClass(line: string): string {
    const upper = line.toUpperCase();
    if (upper.includes(" ERROR ")) return "log-error";
    if (upper.includes(" WARN ")) return "log-warn";
    if (upper.includes(" INFO ")) return "log-info";
    if (upper.includes(" DEBUG ")) return "log-debug";
    return "";
  }

  onMount(() => {
    loadLogs();
    loadLogPath();
  });
</script>

<div class="section">
  <h2>Application Logs</h2>
  <p class="hint">Logs capture key operations like Copilot enhancements, speech sessions, settings changes, and errors. Old logs are automatically deleted after 7 days.</p>

  {#if logPath}
    <p class="hint log-path">Log directory: <code>{logPath}</code></p>
  {/if}

  <div class="log-toolbar">
    <input
      class="log-filter-input"
      type="text"
      placeholder="Filter logs..."
      bind:value={filterText}
    />
    <select class="log-level-select" bind:value={filterLevel}>
      <option value="all">All levels</option>
      <option value="info">Info</option>
      <option value="warn">Warn</option>
      <option value="error">Error</option>
    </select>
    <button class="log-btn" onclick={loadLogs} disabled={loading}>
      {loading ? "Loading..." : "Refresh"}
    </button>
    <button class="log-btn log-btn-danger" onclick={clearLogs}>Clear</button>
  </div>

  <div class="log-stats">
    {filteredLines.length} {filteredLines.length === 1 ? "entry" : "entries"}
    {#if filterText.trim() || filterLevel !== "all"}
      <span class="log-stats-filtered">(filtered)</span>
    {/if}
  </div>

  <div class="log-viewer">
    {#if filteredLines.length === 0}
      <div class="log-empty">
        {#if logContent}
          No log entries match the current filter.
        {:else}
          No log entries yet. Logs will appear as you use the application.
        {/if}
      </div>
    {:else}
      {#each filteredLines as line}
        <div class="log-line {levelClass(line)}">{line}</div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .log-path code {
    font-size: 11px;
    background: var(--surface);
    padding: 2px 6px;
    border-radius: 3px;
    user-select: all;
  }

  .log-toolbar {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-bottom: 8px;
    flex-wrap: wrap;
  }

  .log-filter-input {
    flex: 1;
    min-width: 150px;
    padding: 5px 10px;
    background: var(--input-bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-primary);
    font-size: 12px;
    outline: none;
  }
  .log-filter-input:focus {
    border-color: var(--accent);
  }

  .log-level-select {
    padding: 5px 8px;
    background: var(--input-bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-primary);
    font-size: 12px;
    cursor: pointer;
    outline: none;
  }
  .log-level-select:focus {
    border-color: var(--accent);
  }

  .log-btn {
    padding: 5px 14px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-primary);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
  }
  .log-btn:hover:not(:disabled) {
    background: var(--accent);
    color: var(--bg-primary);
    border-color: var(--accent);
  }
  .log-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .log-btn-danger {
    color: var(--red);
    border-color: var(--red);
  }
  .log-btn-danger:hover {
    background: var(--red) !important;
    color: #fff !important;
    border-color: var(--red) !important;
  }

  .log-stats {
    font-size: 11px;
    color: var(--text-muted);
    margin-bottom: 6px;
  }
  .log-stats-filtered {
    color: var(--accent);
  }

  .log-viewer {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 8px;
    max-height: 400px;
    overflow-y: auto;
    font-family: "SF Mono", "Cascadia Code", "Consolas", monospace;
    font-size: 11px;
    line-height: 1.5;
  }

  .log-empty {
    color: var(--text-muted);
    text-align: center;
    padding: 24px 12px;
    font-family: inherit;
    font-size: 13px;
  }

  .log-line {
    padding: 1px 4px;
    border-radius: 2px;
    white-space: pre-wrap;
    word-break: break-all;
  }
  .log-line:hover {
    background: color-mix(in srgb, var(--text-muted) 8%, transparent);
  }

  .log-error {
    color: var(--red);
  }
  .log-warn {
    color: var(--yellow);
  }
  .log-info {
    color: var(--text-primary);
  }
  .log-debug {
    color: var(--text-muted);
  }
</style>
