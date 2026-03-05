<script lang="ts">
  import { clearHistory } from "../../lib/historyStore";

  let {
    historyEnabled = $bindable(),
    historyMaxEntries = $bindable(),
  }: {
    historyEnabled: boolean;
    historyMaxEntries: number;
  } = $props();

  let showClearHistoryConfirm = $state(false);
</script>

<div class="section">
  <h2>History</h2>

  <label class="field toggle-field">
    <span class="label">Enable History</span>
    <div class="toggle-row">
      <input type="checkbox" bind:checked={historyEnabled} class="toggle-checkbox" />
      <span class="toggle-label">{historyEnabled ? 'On' : 'Off'}</span>
    </div>
    <span class="hint">Save transcription history for later reference.</span>
  </label>

  <label class="field">
    <span class="label">Maximum Entries</span>
    <input type="number" min="1" max="500" bind:value={historyMaxEntries} disabled={!historyEnabled} style="width: 100px;" />
    <span class="hint">Oldest entries are removed when the limit is reached (1–500).</span>
  </label>

  <div class="field">
    <span class="label">Clear History</span>
    {#if showClearHistoryConfirm}
      <div class="usage-actions">
        <span class="reset-confirm-text">Delete all history entries?</span>
        <button type="button" class="toggle-btn reset-yes" onclick={async () => { await clearHistory(); showClearHistoryConfirm = false; }}>Yes, clear</button>
        <button type="button" class="toggle-btn" onclick={() => (showClearHistoryConfirm = false)}>Cancel</button>
      </div>
    {:else}
      <div class="usage-actions">
        <button type="button" class="toggle-btn" onclick={() => (showClearHistoryConfirm = true)}>Clear All History</button>
      </div>
    {/if}
    <span class="hint">Permanently remove all saved transcription history.</span>
  </div>
</div>
