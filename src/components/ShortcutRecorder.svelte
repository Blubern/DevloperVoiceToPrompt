<script lang="ts">
  let { value = $bindable() }: { value: string } = $props();

  let recording = $state(false);
  let pressedKeys = $state<string[]>([]);

  function startRecording() {
    recording = true;
    pressedKeys = [];
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!recording) return;

    e.preventDefault();
    e.stopPropagation();

    const parts: string[] = [];

    if (e.ctrlKey || e.metaKey) parts.push("CommandOrControl");
    if (e.altKey) parts.push("Alt");
    if (e.shiftKey) parts.push("Shift");

    // Ignore standalone modifier keys
    const modifierKeys = ["Control", "Meta", "Alt", "Shift"];
    if (!modifierKeys.includes(e.key)) {
      // Map key to Tauri shortcut format
      let key = e.key;
      if (key === " ") key = "Space";
      else if (key.length === 1) key = key.toUpperCase();
      else if (key === "ArrowUp") key = "Up";
      else if (key === "ArrowDown") key = "Down";
      else if (key === "ArrowLeft") key = "Left";
      else if (key === "ArrowRight") key = "Right";

      parts.push(key);

      const shortcutStr = parts.join("+");
      value = shortcutStr;
      recording = false;
    }

    pressedKeys = parts;
  }

  function handleKeyup() {
    if (recording) {
      pressedKeys = [];
    }
  }

  function cancel() {
    recording = false;
    pressedKeys = [];
  }

  function clear() {
    value = "";
  }
</script>

<svelte:window
  onkeydown={(e) => { if (recording) handleKeydown(e); }}
  onkeyup={(e) => { if (recording) handleKeyup(); }}
/>

<div class="shortcut-recorder">
  <div class="display" class:recording>
    {#if recording}
      {#if pressedKeys.length > 0}
        <span class="keys">{pressedKeys.join(" + ")}</span>
      {:else}
        <span class="placeholder">Press keys...</span>
      {/if}
    {:else}
      {#if value}
        <span class="current">{value}</span>
      {:else}
        <span class="placeholder">No shortcut set</span>
      {/if}
    {/if}
  </div>

  {#if recording}
    <button type="button" class="rec-btn cancel" onclick={cancel}>Cancel</button>
  {:else}
    <button type="button" class="rec-btn" onclick={startRecording}>Record</button>
    {#if value}
      <button type="button" class="rec-btn clear" onclick={clear} title="Clear shortcut">✕</button>
    {/if}
  {/if}
</div>

<style>
  .shortcut-recorder {
    display: flex;
    gap: 6px;
    align-items: stretch;
  }

  .display {
    flex: 1;
    padding: 8px 10px;
    background: var(--input-bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 13px;
    color: var(--text-primary);
    display: flex;
    align-items: center;
    font-family: "SF Mono", "Cascadia Code", "Consolas", monospace;
    min-height: 36px;
  }

  .display.recording {
    border-color: var(--warning);
    background: var(--warning-bg);
  }

  .placeholder {
    color: var(--text-muted);
    font-style: italic;
  }

  .keys {
    color: var(--warning);
  }

  .current {
    color: var(--text-primary);
  }

  .rec-btn {
    padding: 6px 14px;
    background: var(--surface);
    border: 1px solid var(--surface-hover);
    color: var(--text-secondary);
    border-radius: 6px;
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
  }

  .rec-btn:hover {
    background: var(--surface-hover);
  }

  .rec-btn.cancel {
    border-color: var(--error);
    color: var(--error);
  }

  .rec-btn.cancel:hover {
    background: var(--error-bg);
  }

  .rec-btn.clear {
    padding: 6px 8px;
    border-color: var(--text-muted);
    color: var(--text-muted);
  }

  .rec-btn.clear:hover {
    border-color: var(--error);
    color: var(--error);
    background: var(--error-bg);
  }
</style>
