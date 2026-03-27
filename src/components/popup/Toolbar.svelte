<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { emit } from "@tauri-apps/api/event";
  import type { AppSettings } from "../../lib/settingsStore";
  import { saveSettings } from "../../lib/settingsStore";
  import { providerRegistry, type AudioDevice } from "../../lib/speechService";
  import { EVENT_SETTINGS_UPDATED } from "../../lib/constants";
  import type { AIProviderIndicator } from "../../lib/ai/aiService";

  interface Props {
    settings: AppSettings;
    status: string;
    enhancing: boolean;
    historyOpen: boolean;
    templatesOpen: boolean;
    historyCount: number;
    audioDevices: AudioDevice[];
    selectedMicLabel: string;
    micDropdownOpen: boolean;
    langDropdownOpen: boolean;
    langDropdownFilter: string;
    languageDisplayLabels: string[];
    filteredPopupLanguages: readonly { code: string; label: string }[];
    activePlugin: ReturnType<typeof providerRegistry.get>;
    activeConfig: Record<string, unknown>;
    aiIndicator: AIProviderIndicator | null;
    aiProviderReady: boolean;
    onToggleHistory: () => void;
    onToggleTemplates: () => void;
    onSelectMicrophone: (deviceId: string) => void;
    onLanguageToggle: (code: string) => void;
  }

  let {
    settings = $bindable(),
    status,
    enhancing,
    historyOpen,
    templatesOpen,
    historyCount,
    audioDevices,
    selectedMicLabel,
    micDropdownOpen = $bindable(),
    langDropdownOpen = $bindable(),
    langDropdownFilter = $bindable(),
    languageDisplayLabels,
    filteredPopupLanguages,
    activePlugin,
    activeConfig,
    aiIndicator,
    aiProviderReady,
    onToggleHistory,
    onToggleTemplates,
    onSelectMicrophone,
    onLanguageToggle,
  }: Props = $props();
</script>

<div class="toolbar">
  <div class="toolbar-left">
    <button
      class="provider-toggle"
      onclick={async () => {
        if (status !== "listening") {
          settings = { ...settings, speech_provider: providerRegistry.cycle(settings.speech_provider) };
          try {
            await saveSettings(settings);
            await emit(EVENT_SETTINGS_UPDATED);
          } catch (e) {
            console.error("Failed to persist provider change:", e);
          }
        }
      }}
      disabled={status === "listening"}
      title={`Using ${providerRegistry.getLabel(settings.speech_provider)} — click to switch`}
    >
      {providerRegistry.getLabel(settings.speech_provider)}
    </button>
    {#if activePlugin && activePlugin.languageMode !== "none" && languageDisplayLabels.length > 0}
      {#if status === "listening"}
        <span class="lang-indicator" title={languageDisplayLabels.join(', ')}>{languageDisplayLabels.join(' · ')}</span>
      {:else}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <button class="lang-indicator lang-selector-btn" onclick={(e) => { e.stopPropagation(); langDropdownOpen = !langDropdownOpen; langDropdownFilter = ''; }} title="Click to change language">
          {languageDisplayLabels.join(' · ')} ▾
        </button>
      {/if}
    {/if}
    {#if langDropdownOpen && status !== "listening" && activePlugin}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="lang-dropdown" onclick={(e) => e.stopPropagation()}>
        <input
          class="lang-dropdown-filter"
          type="text"
          placeholder="Filter languages..."
          bind:value={langDropdownFilter}
        />
        <div class="lang-dropdown-list">
          {#each filteredPopupLanguages as lang}
            {#if activePlugin.languageMode === "multi"}
              {@const selectedLangs = (activeConfig[activePlugin.languageConfigKey] as string[] | undefined) ?? []}
              <label class="lang-dropdown-item">
                <input
                  type="checkbox"
                  checked={selectedLangs.includes(lang.code)}
                  onchange={() => onLanguageToggle(lang.code)}
                />
                <span>{lang.label}</span>
                <span class="lang-dropdown-code">{lang.code}</span>
              </label>
            {:else}
              {@const selectedLang = (activeConfig[activePlugin.languageConfigKey] as string | undefined) ?? ""}
              <button
                class="lang-dropdown-item"
                class:selected={selectedLang === lang.code}
                onclick={() => onLanguageToggle(lang.code)}
              >
                <span>{lang.label}</span>
                <span class="lang-dropdown-code">{lang.code}</span>
              </button>
            {/if}
          {/each}
        </div>
      </div>
    {/if}
  </div>
  <div class="toolbar-buttons">
    <!-- Microphone selector -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="mic-selector-wrapper" onclick={(e) => e.stopPropagation()}>
      <button
        class="mic-selector-btn"
        onclick={() => { micDropdownOpen = !micDropdownOpen; }}
        disabled={status === "listening" || enhancing}
        title={`Microphone: ${selectedMicLabel}`}
      >
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>
        <span class="mic-selector-label">{selectedMicLabel}</span>
        <span class="mic-selector-chevron">▾</span>
      </button>
      {#if micDropdownOpen && status !== "listening"}
        <div class="mic-dropdown">
          <button
            class="mic-dropdown-item"
            class:selected={!settings.microphone_device_id}
            onclick={() => onSelectMicrophone("")}
          >
            System Default
          </button>
          {#each audioDevices as device}
            <button
              class="mic-dropdown-item"
              class:selected={settings.microphone_device_id === device.deviceId}
              onclick={() => onSelectMicrophone(device.deviceId)}
            >
              {device.label}
            </button>
          {/each}
        </div>
      {/if}
    </div>

    <button
      class="toolbar-toggle"
      onclick={onToggleTemplates}
      class:active={templatesOpen}
      disabled={enhancing}
      aria-label="Toggle templates"
      aria-pressed={templatesOpen}
    >
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
      Templates
    </button>
    {#if settings.history_enabled}
      <button
        class="toolbar-toggle"
        onclick={onToggleHistory}
        class:active={historyOpen}
        disabled={enhancing}
        aria-label="Toggle history"
        aria-pressed={historyOpen}
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        History
        {#if historyCount > 0}
          <span class="toolbar-badge">{historyCount}</span>
        {/if}
      </button>
    {/if}
    <button class="toolbar-btn" onclick={() => invoke('show_help')} aria-label="Keyboard shortcuts" title="Keyboard shortcuts">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
    </button>
    {#if settings.ai_enabled && aiProviderReady && aiIndicator}
      {@const indicatorUrl = settings.theme === 'light' ? aiIndicator.imageUrlLight : aiIndicator.imageUrlDark}
      {#if indicatorUrl}
        <img class="ai-toolbar-indicator" src={indicatorUrl} alt={aiIndicator.label} title={aiIndicator.label} />
      {:else}
        <span class="ai-toolbar-indicator ai-toolbar-indicator--text" title={aiIndicator.label}>{aiIndicator.label.charAt(0).toUpperCase()}</span>
      {/if}
    {/if}
    <button class="toolbar-btn" onclick={() => invoke('show_settings')} aria-label="Settings" title="Settings">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
    </button>
    <button class="toolbar-btn" onclick={() => invoke('show_about')} aria-label="About" title="About">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
    </button>
  </div>
</div>

<style>
  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 8px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
    user-select: none;
    -webkit-user-select: none;
  }

  .toolbar-left {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 0;
    position: relative;
  }

  .provider-toggle {
    font-size: 10px;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 4px;
    border: 1px solid var(--accent);
    background: color-mix(in srgb, var(--accent) 15%, transparent);
    color: var(--accent);
    cursor: pointer;
    line-height: 1;
    vertical-align: middle;
    transition: all 0.15s;
  }

  .provider-toggle:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent) 30%, transparent);
  }

  .provider-toggle:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .lang-indicator {
    font-size: 10px;
    color: var(--text-muted);
    padding: 2px 6px;
    border-radius: 4px;
    background: var(--lang-tag-bg);
    border: 1px solid var(--lang-tag-border);
    cursor: help;
    display: inline-flex;
    align-items: center;
    line-height: 1;
    vertical-align: middle;
    white-space: nowrap;
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .lang-selector-btn {
    cursor: pointer;
    border: 1px solid var(--accent);
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }
  .lang-selector-btn:hover {
    background: color-mix(in srgb, var(--accent) 20%, transparent);
  }

  .lang-dropdown {
    position: absolute;
    top: 100%;
    left: 0;
    z-index: 100;
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    width: 240px;
    max-height: 280px;
    display: flex;
    flex-direction: column;
    margin-top: 4px;
  }
  .lang-dropdown-filter {
    padding: 6px 8px;
    border: none;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
    color: var(--text-primary);
    font-size: 11px;
    outline: none;
    border-radius: 6px 6px 0 0;
  }
  .lang-dropdown-list {
    overflow-y: auto;
    max-height: 240px;
    padding: 4px 0;
  }
  .lang-dropdown-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    font-size: 11px;
    color: var(--text-primary);
    cursor: pointer;
    border: none;
    background: none;
    width: 100%;
    text-align: left;
  }
  .lang-dropdown-item:hover {
    background: color-mix(in srgb, var(--accent) 15%, transparent);
  }
  .lang-dropdown-item.selected {
    background: color-mix(in srgb, var(--accent) 20%, transparent);
    font-weight: 600;
  }
  .lang-dropdown-code {
    margin-left: auto;
    color: var(--text-muted);
    font-size: 10px;
  }

  .toolbar-buttons {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .toolbar-btn {
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 14px;
    padding: 2px 6px;
    border-radius: 4px;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .toolbar-btn:hover {
    background: var(--surface-hover);
    color: var(--accent);
  }

  /* ---- Mic Selector ---- */
  .mic-selector-wrapper {
    position: relative;
    margin-right: 4px;
  }

  .mic-selector-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 10px;
    font-weight: 500;
    padding: 3px 8px;
    border-radius: 6px;
    transition: all 0.15s;
    line-height: 1;
    max-width: 180px;
  }

  .mic-selector-btn:hover:not(:disabled) {
    background: var(--surface-hover);
    color: var(--accent);
    border-color: var(--accent);
  }

  .mic-selector-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .mic-selector-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 120px;
  }

  .mic-selector-chevron {
    font-size: 8px;
    opacity: 0.6;
  }

  .mic-dropdown {
    position: absolute;
    top: 100%;
    right: 0;
    z-index: 100;
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    width: 260px;
    max-height: 200px;
    overflow-y: auto;
    margin-top: 4px;
    padding: 4px 0;
  }

  .mic-dropdown-item {
    display: block;
    width: 100%;
    padding: 6px 10px;
    font-size: 11px;
    color: var(--text-primary);
    cursor: pointer;
    border: none;
    background: none;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .mic-dropdown-item:hover {
    background: color-mix(in srgb, var(--accent) 15%, transparent);
  }

  .mic-dropdown-item.selected {
    background: color-mix(in srgb, var(--accent) 20%, transparent);
    font-weight: 600;
    color: var(--accent);
  }

  .toolbar-toggle {
    display: flex;
    align-items: center;
    gap: 5px;
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 11px;
    font-weight: 500;
    padding: 3px 10px;
    border-radius: 6px;
    transition: all 0.15s;
    margin-right: 4px;
    line-height: 1;
  }

  .toolbar-toggle:hover {
    background: var(--surface-hover);
    color: var(--accent);
    border-color: var(--accent);
  }

  .toolbar-toggle.active {
    background: var(--accent);
    color: var(--bg-primary);
    border-color: var(--accent);
  }

  .toolbar-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: 8px;
    background: var(--accent);
    color: var(--bg-primary);
    font-size: 10px;
    font-weight: 700;
    line-height: 1;
  }

  .toolbar-toggle.active .toolbar-badge {
    background: var(--bg-primary);
    color: var(--accent);
  }

  .ai-toolbar-indicator {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    flex-shrink: 0;
    margin: 0 -1px;
  }

  .ai-toolbar-indicator--text {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: 700;
    color: var(--ctp-text);
    background: var(--ctp-surface1);
  }
</style>
