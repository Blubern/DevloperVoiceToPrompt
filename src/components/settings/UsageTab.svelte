<script lang="ts">
  import { getUsageStats, resetUsage, pruneOldEntries, formatDuration, type UsageStats } from "../../lib/usageStore";
  import { onMount } from "svelte";

  let usageStats = $state<UsageStats | null>(null);
  let showResetConfirm = $state(false);

  onMount(async () => {
    await pruneOldEntries();
    usageStats = await getUsageStats();
  });
</script>

<div class="section">
  <h2>Usage Statistics</h2>
  {#if usageStats}
    {#each [
      { title: "Total", data: usageStats.total },
      { title: "Web Speech", data: usageStats.web },
      { title: "Azure Speech", data: usageStats.azure },
      { title: "Whisper (Local)", data: usageStats.whisper },
    ] as group}
      <div class="usage-provider-group">
        <h3 class="usage-provider-title">{group.title}</h3>
        <div class="usage-grid">
          <div class="usage-card"><span class="usage-label">Today</span><span class="usage-value">{formatDuration(group.data.today)}</span></div>
          <div class="usage-card"><span class="usage-label">This Week</span><span class="usage-value">{formatDuration(group.data.thisWeek)}</span></div>
          <div class="usage-card"><span class="usage-label">Last 30 Days</span><span class="usage-value">{formatDuration(group.data.last30Days)}</span></div>
        </div>
      </div>
    {/each}

    <div class="usage-actions">
      {#if showResetConfirm}
        <span class="reset-confirm-text">Reset all usage data?</span>
        <button type="button" class="toggle-btn reset-yes" onclick={async () => { await resetUsage(); usageStats = await getUsageStats(); showResetConfirm = false; }}>Yes, reset</button>
        <button type="button" class="toggle-btn" onclick={() => (showResetConfirm = false)}>Cancel</button>
      {:else}
        <button type="button" class="toggle-btn" onclick={() => (showResetConfirm = true)}>Reset Statistics</button>
        <button type="button" class="toggle-btn" onclick={async () => { usageStats = await getUsageStats(); }}>Refresh</button>
      {/if}
    </div>
  {:else}
    <p class="hint">Loading usage data...</p>
  {/if}
</div>
