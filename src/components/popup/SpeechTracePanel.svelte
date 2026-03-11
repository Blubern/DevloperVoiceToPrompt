<script lang="ts">
  import {
    clearTrace,
    formatTraceEntries,
    getCurrentActiveSessionEntries,
    getLatestCompletedSessionEntries,
    getTraceEntries,
    subscribeTrace,
    type SpeechTraceEntry,
  } from "../../lib/speechTraceStore";
  import { writeText } from "@tauri-apps/plugin-clipboard-manager";
  import { onMount } from "svelte";

  let entries = $state<SpeechTraceEntry[]>(getTraceEntries());
  let scrollEl: HTMLDivElement | undefined = $state();
  let autoScroll = $state(true);
  let copiedAction = $state<"all" | "last-session" | "active-session" | null>(null);
  let copiedTimer: ReturnType<typeof setTimeout> | null = null;

  onMount(() => {
    return subscribeTrace(() => {
      entries = [...getTraceEntries()];
    });
  });

  const latestCompletedSessionEntries = $derived(getLatestCompletedSessionEntries(entries));
  const currentActiveSessionEntries = $derived(getCurrentActiveSessionEntries(entries));

  // Auto-scroll to bottom when new entries arrive and autoScroll is on
  $effect(() => {
    const _ = entries.length;
    if (autoScroll && scrollEl) {
      requestAnimationFrame(() => {
        if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
      });
    }
  });

  function handleScroll() {
    if (!scrollEl) return;
    const atBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 30;
    autoScroll = atBottom;
  }

  function setCopiedAction(action: "all" | "last-session" | "active-session") {
    copiedAction = action;
    if (copiedTimer !== null) {
      clearTimeout(copiedTimer);
    }
    copiedTimer = setTimeout(() => {
      copiedAction = null;
      copiedTimer = null;
    }, 1500);
  }

  async function copyAll() {
    await writeText(formatTraceEntries(entries));
    setCopiedAction("all");
  }

  async function copyLastSession() {
    if (latestCompletedSessionEntries.length === 0) return;

    await writeText(formatTraceEntries(latestCompletedSessionEntries));
    setCopiedAction("last-session");
  }

  async function copyCurrentActiveSession() {
    if (currentActiveSessionEntries.length === 0) return;

    await writeText(formatTraceEntries(currentActiveSessionEntries));
    setCopiedAction("active-session");
  }

  function levelClass(level: SpeechTraceEntry["level"]): string {
    if (level === "warn") return "trace-warn";
    if (level === "data") return "trace-data";
    if (level === "event") return "trace-event";
    return "trace-info";
  }

  function levelIcon(level: SpeechTraceEntry["level"]): string {
    if (level === "warn") return "⚠";
    if (level === "data") return "◆";
    if (level === "event") return "›";
    return "ℹ";
  }
</script>

<div class="trace-panel">
  <div class="trace-header">
    <span class="trace-title">
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
      Speech Trace
      <span class="trace-count">{entries.length}</span>
    </span>
    <span class="trace-actions">
      <button class="trace-btn" onclick={copyAll} title="Copy all entries" disabled={entries.length === 0}>
        {copiedAction === "all" ? "Copied!" : "Copy All"}
      </button>
      <button class="trace-btn" onclick={copyLastSession} title="Copy the latest completed session" disabled={latestCompletedSessionEntries.length === 0}>
        {copiedAction === "last-session" ? "Copied!" : "Copy Last Session"}
      </button>
      <button class="trace-btn" onclick={copyCurrentActiveSession} title="Copy the current active session" disabled={currentActiveSessionEntries.length === 0}>
        {copiedAction === "active-session" ? "Copied!" : "Copy Current Active Session"}
      </button>
      <button class="trace-btn" onclick={clearTrace} title="Clear trace">Clear</button>
    </span>
  </div>
  <div class="trace-body" bind:this={scrollEl} onscroll={handleScroll}>
    {#if entries.length === 0}
      <div class="trace-empty">No trace entries yet. Start recording to see speech events.</div>
    {:else}
      {#each entries as entry}
        <div class="trace-line {levelClass(entry.level)}">
          <span class="trace-time">{entry.time}</span>
          <span class="trace-icon">{levelIcon(entry.level)}</span>
          <span class="trace-evt">{entry.event}</span>
          <span class="trace-detail">{entry.detail}</span>
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .trace-panel {
    border-top: 1px solid var(--border);
    background: var(--bg-secondary);
    display: flex;
    flex-direction: column;
    max-height: 180px;
    min-height: 80px;
    flex-shrink: 0;
  }

  .trace-header {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 8px;
    flex-wrap: wrap;
    padding: 4px 10px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .trace-title {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    flex-wrap: wrap;
  }

  .trace-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    justify-content: flex-start;
  }

  .trace-count {
    background: var(--surface);
    padding: 0 5px;
    border-radius: 8px;
    font-size: 10px;
    font-weight: 500;
    color: var(--text-muted);
  }

  .trace-btn {
    background: none;
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text-muted);
    font-size: 10px;
    padding: 1px 6px;
    cursor: pointer;
    transition: all 0.15s;
  }
  .trace-btn:hover {
    color: var(--text-primary);
    border-color: var(--text-muted);
  }

  .trace-btn:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .trace-body {
    overflow-y: auto;
    flex: 1;
    padding: 2px 0;
    font-family: "SF Mono", "Cascadia Code", "Consolas", monospace;
    font-size: 10.5px;
    line-height: 1.5;
  }

  .trace-empty {
    color: var(--text-muted);
    text-align: center;
    padding: 16px 12px;
    font-family: inherit;
    font-size: 11px;
  }

  .trace-line {
    display: flex;
    gap: 6px;
    padding: 0 8px;
    white-space: nowrap;
  }
  .trace-line:hover {
    background: color-mix(in srgb, var(--text-muted) 6%, transparent);
  }

  .trace-time {
    color: var(--text-muted);
    flex-shrink: 0;
    min-width: 72px;
  }

  .trace-icon {
    flex-shrink: 0;
    width: 12px;
    text-align: center;
  }

  .trace-evt {
    color: var(--accent);
    flex-shrink: 0;
    min-width: 100px;
    font-weight: 500;
  }

  .trace-detail {
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .trace-warn .trace-icon,
  .trace-warn .trace-evt {
    color: var(--yellow);
  }

  .trace-data .trace-icon,
  .trace-data .trace-evt {
    color: var(--green);
  }

  .trace-event .trace-icon,
  .trace-event .trace-evt {
    color: var(--accent);
  }

  .trace-info .trace-icon,
  .trace-info .trace-evt {
    color: var(--text-muted);
  }
</style>
