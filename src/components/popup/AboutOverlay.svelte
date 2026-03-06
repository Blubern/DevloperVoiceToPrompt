<script lang="ts">
  import { getVersion } from "@tauri-apps/api/app";
  import { open } from "@tauri-apps/plugin-shell";
  import { onMount } from "svelte";
  import { ABOUT_LIBRARIES, APP_GITHUB_URL, type LibraryInfo } from "../../lib/constants";

  let {
    open: isOpen = $bindable(),
  }: {
    open: boolean;
  } = $props();

  let version = $state("...");

  const categories = $derived.by(() => {
    const map = new Map<string, LibraryInfo[]>();
    for (const lib of ABOUT_LIBRARIES) {
      const list = map.get(lib.category) ?? [];
      list.push(lib);
      map.set(lib.category, list);
    }
    return [...map.entries()];
  });

  onMount(async () => {
    try {
      version = await getVersion();
    } catch {
      version = "unknown";
    }
  });
</script>

{#if isOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="help-backdrop" onclick={() => isOpen = false}></div>
  <div class="about-overlay">
    <div class="about-header">
      <h2 class="about-app-name">Developer Voice to Prompt</h2>
      <p class="about-tagline">A desktop dictation app with three speech providers<br />and AI-powered prompt enhancement.</p>
      <span class="about-version-badge">v{version}</span>
      <br />
      <!-- svelte-ignore a11y_invalid_attribute -->
      <a class="about-repo-link" href="#" onclick={(e) => { e.preventDefault(); open(APP_GITHUB_URL); }}>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg>
        View on GitHub
      </a>
    </div>

    <div class="about-section-title">Built With</div>

    {#each categories as [category, libs]}
      <div class="about-category-title">{category}</div>
      <div class="about-grid">
        {#each libs as lib}
          <div class="about-card">
            <span class="about-card-name">
              {#if lib.url}
                <!-- svelte-ignore a11y_invalid_attribute -->
                <a href="#" onclick={(e) => { e.preventDefault(); open(lib.url!); }}>{lib.name}</a>
                <svg class="about-card-link-icon" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              {:else}
                {lib.name}
              {/if}
            </span>
            <span class="about-card-desc">{lib.description}</span>
          </div>
        {/each}
      </div>
    {/each}

    <div class="about-footer">
      Built with <span class="about-footer-heart">&#9829;</span> using Tauri, Svelte &amp; Rust
    </div>
  </div>
{/if}
