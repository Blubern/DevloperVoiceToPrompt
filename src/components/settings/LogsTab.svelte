<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { onMount } from "svelte";

  let logContent = $state("");
  let logPath = $state("");
  let loading = $state(false);
  let filterText = $state("");
  let filterLevel = $state<"all" | "info" | "warn" | "error">("warn");
  let copiedBtn = $state<string | null>(null);

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

  /** Returns filteredLines restricted to lines within the last `hours` hours. */
  function linesForWindow(hours: number): string[] {
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    return filteredLines.filter((line) => {
      // tracing format: "2026-03-10T14:30:00.123456Z  INFO ..."
      const token = line.trimStart().split(/\s+/)[0];
      const ts = new Date(token).getTime();
      return !isNaN(ts) && ts >= cutoff;
    });
  }

  async function copyToClipboard(key: string, lines: string[]) {
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
    } catch {
      // fallback for environments where clipboard API is restricted
      const ta = document.createElement("textarea");
      ta.value = lines.join("\n");
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    copiedBtn = key;
    setTimeout(() => (copiedBtn = null), 1500);
  }

  async function loadLogPath() {
    try {
      logPath = await invoke<string>("get_log_path");
    } catch {
      logPath = "";
    }
  }

  async function openLogFolder() {
    try {
      await invoke("open_log_folder");
    } catch {
      // ignore
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
  <p class="hint">
    Logs capture key operations: Copilot enhancements, speech sessions, settings
    changes, and errors. Old logs are automatically deleted after 7 days.
  </p>

  {#if logPath}
    <div class="log-path-row">
      <code class="log-path-code" title={logPath}>{logPath}</code>
      <button class="log-btn log-btn-sm" onclick={openLogFolder} title="Open log folder in Explorer">Open folder</button>
    </div>
  {/if}

  <!-- Action row: export + refresh / clear -->
  <div class="log-action-row">
    <span class="toolbar-group-label">Export:</span>
    <button
      class="log-btn log-btn-copy"
      title="Copy all visible log entries to clipboard"
      onclick={() => copyToClipboard("all", filteredLines)}
    >
      {copiedBtn === "all" ? "✓ Copied" : "Copy All"}
    </button>
    <button
      class="log-btn log-btn-copy"
      title="Copy visible log entries from the last 24 hours"
      onclick={() => copyToClipboard("1d", linesForWindow(24))}
    >
      {copiedBtn === "1d" ? "✓ Copied" : "Last 24 h"}
    </button>
    <button
      class="log-btn log-btn-copy"
      title="Copy visible log entries from the last 12 hours"
      onclick={() => copyToClipboard("12h", linesForWindow(12))}
    >
      {copiedBtn === "12h" ? "✓ Copied" : "Last 12 h"}
    </button>
    <button
      class="log-btn log-btn-copy"
      title="Copy visible log entries from the last 6 hours"
      onclick={() => copyToClipboard("6h", linesForWindow(6))}
    >
      {copiedBtn === "6h" ? "✓ Copied" : "Last 6 h"}
    </button>
    <button
      class="log-btn log-btn-copy"
      title="Copy visible log entries from the last hour"
      onclick={() => copyToClipboard("1h", linesForWindow(1))}
    >
      {copiedBtn === "1h" ? "✓ Copied" : "Last 1 h"}
    </button>
    <div class="log-action-spacer"></div>
    <button class="log-btn" onclick={loadLogs} disabled={loading} title="Reload logs from disk">
      {loading ? "Loading…" : "Refresh"}
    </button>
    <button class="log-btn log-btn-danger" onclick={clearLogs} title="Delete all log files">Clear All</button>
  </div>

  <!-- Log box: filter header fused to the top of the viewer -->
  <div class="log-box">
    <div class="log-box-header">
      <input
        class="log-box-search"
        type="text"
        placeholder="Search…"
        title="Filter log lines containing this text (case-insensitive)"
        bind:value={filterText}
      />
      <select
        class="log-box-level"
        bind:value={filterLevel}
        title="Show only log entries at this severity level or above"
      >
        <option value="all">All levels</option>
        <option value="info">Info &amp; above</option>
        <option value="warn">Warn &amp; above</option>
        <option value="error">Error only</option>
      </select>
      <span class="log-box-count">
        {#if filterText.trim() || filterLevel !== "all"}
          {filteredLines.length} / {logContent.split("\n").filter(Boolean).length}
        {:else}
          {filteredLines.length} {filteredLines.length === 1 ? "entry" : "entries"}
        {/if}
      </span>
    </div>
    <div class="log-box-content">
      {#if filteredLines.length === 0}
        <div class="log-empty">
          {#if logContent && (filterText.trim() || filterLevel !== "all")}
            No entries match the current filters.
          {:else if logContent}
            No log entries yet. Activity will appear here as you use the app.
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
</div>

<style>
  .log-path-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
  }

  .log-path-code {
    flex: 1;
    font-size: 11px;
    background: var(--surface);
    border: 1px solid var(--border);
    padding: 3px 8px;
    border-radius: 4px;
    user-select: all;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-muted);
    cursor: text;
  }

  .log-action-row {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    margin-bottom: 8px;
  }

  .log-action-spacer {
    flex: 1;
  }

  .toolbar-group-label {
    font-size: 11px;
    color: var(--text-muted);
    white-space: nowrap;
  }

  /* Log box: unified border wraps both the filter header and the content */
  .log-box {
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
  }

  .log-box-header {
    display: flex;
    align-items: stretch;
    background: color-mix(in srgb, var(--surface) 60%, var(--bg-primary));
    border-bottom: 1px solid var(--border);
  }

  .log-box-search {
    flex: 1;
    min-width: 0;
    padding: 7px 10px;
    background: transparent;
    border: none;
    border-right: 1px solid var(--border);
    color: var(--text-primary);
    font-size: 12px;
    outline: none;
  }
  .log-box-search::placeholder {
    color: var(--text-muted);
  }
  .log-box-search:focus {
    background: color-mix(in srgb, var(--accent) 6%, transparent);
  }

  .log-box-level {
    flex-shrink: 0;
    width: 140px;
    padding: 7px 8px;
    background: transparent;
    border: none;
    border-right: 1px solid var(--border);
    color: var(--text-primary);
    font-size: 12px;
    cursor: pointer;
    outline: none;
  }
  .log-box-level:focus {
    background: color-mix(in srgb, var(--accent) 6%, transparent);
  }

  .log-box-count {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    padding: 0 10px;
    font-size: 11px;
    color: var(--text-muted);
    white-space: nowrap;
  }

  .log-box-content {
    background: var(--surface);
    padding: 8px;
    max-height: 400px;
    overflow-y: auto;
    font-family: "SF Mono", "Cascadia Code", "Consolas", monospace;
    font-size: 11px;
    line-height: 1.5;
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
    white-space: nowrap;
    flex-shrink: 0;
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

  .log-btn-sm {
    padding: 3px 10px;
    font-size: 11px;
  }

  .log-btn-copy {
    color: var(--text-muted);
  }
  .log-btn-copy:hover {
    color: var(--bg-primary);
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
