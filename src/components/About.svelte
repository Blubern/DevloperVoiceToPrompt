<script lang="ts">
  import { getVersion } from "@tauri-apps/api/app";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { onMount } from "svelte";
  import { ABOUT_LIBRARIES, APP_GITHUB_URL, type LibraryInfo } from "../lib/constants";

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

<div class="about-page">
  <div class="about-header">
    <h2 class="about-app-name">Developer Voice to Prompt</h2>
    <p class="about-tagline">A desktop dictation app with three speech providers<br />and AI-powered prompt enhancement.</p>
    <span class="about-version-badge">v{version}</span>
    <br />
    <!-- svelte-ignore a11y_invalid_attribute -->
    <a class="about-repo-link" href="#" onclick={(e) => { e.preventDefault(); openUrl(APP_GITHUB_URL); }}>
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
              <a href="#" onclick={(e) => { e.preventDefault(); openUrl(lib.url!); }}>{lib.name}</a>
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

<style>
  .about-page {
    padding: 24px;
    background: var(--bg-primary);
    color: var(--text-primary);
    height: 100vh;
    box-sizing: border-box;
    overflow-y: auto;
  }

  .about-header {
    text-align: center;
    margin-bottom: 20px;
  }

  .about-app-name {
    font-size: 18px;
    font-weight: 700;
    margin: 0 0 6px 0;
    color: var(--text-primary);
  }

  .about-tagline {
    font-size: 12px;
    color: var(--text-muted);
    margin: 0 0 10px 0;
    line-height: 1.4;
  }

  .about-version-badge {
    display: inline-block;
    font-size: 11px;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--accent) 15%, transparent);
    color: var(--accent);
    border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
  }

  .about-repo-link {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--text-muted);
    text-decoration: none;
    margin-top: 6px;
    cursor: pointer;
    transition: color 0.15s;
  }

  .about-repo-link:hover {
    color: var(--accent);
  }

  .about-section-title {
    font-size: 13px;
    font-weight: 700;
    color: var(--text-primary);
    margin-bottom: 8px;
  }

  .about-category-title {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin: 12px 0 4px 0;
  }

  .about-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }

  .about-card {
    display: flex;
    flex-direction: column;
    padding: 6px 8px;
    border-radius: 6px;
    background: var(--surface);
    border: 1px solid var(--border);
  }

  .about-card-name {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-primary);
    display: flex;
    align-items: center;
    gap: 3px;
  }

  .about-card-name a {
    color: var(--accent);
    text-decoration: none;
    cursor: pointer;
  }

  .about-card-name a:hover {
    text-decoration: underline;
  }

  .about-card-link-icon {
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .about-card-desc {
    font-size: 10px;
    color: var(--text-muted);
    line-height: 1.3;
  }

  .about-footer {
    text-align: center;
    font-size: 11px;
    color: var(--text-muted);
    margin-top: 20px;
    padding-top: 12px;
    border-top: 1px solid var(--border);
  }

  .about-footer-heart {
    color: var(--error);
  }
</style>
