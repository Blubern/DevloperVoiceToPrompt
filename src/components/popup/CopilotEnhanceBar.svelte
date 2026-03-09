<script lang="ts">
  import { listen, emit } from "@tauri-apps/api/event";
  import { untrack } from "svelte";
  import type { AppSettings } from "../../lib/settingsStore";
  import { saveSettings } from "../../lib/settingsStore";
  import {
    EVENT_SETTINGS_UPDATED,
    EVENT_ENHANCER_TEMPLATES_UPDATED,
    type RecordingStatus,
  } from "../../lib/constants";
  import {
    copilotInit,
    copilotAuthStatus,
    copilotListModels,
    copilotStop,
    type CopilotAuthStatus,
    type CopilotModel,
  } from "../../lib/copilotStore";
  import {
    getEnhancerTemplates,
    type EnhancerTemplate,
  } from "../../lib/enhancerTemplateStore";

  interface Props {
    settings: AppSettings;
    status: RecordingStatus;
    editedText: string;
    enhancing: boolean;
    enhanceUndoStackSize: number;
    onEnhance: (modelId: string, systemPrompt: string) => void;
    onUndo: () => void;
    onSettingsChanged: (settings: AppSettings) => void;
    /** Expose connection status and avatar to parent (for titlebar avatar). */
    onStatusUpdate?: (status: CopilotStatus, auth: CopilotAuthStatus | null) => void;
  }

  type CopilotStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

  let {
    settings,
    status,
    editedText,
    enhancing,
    enhanceUndoStackSize,
    onEnhance,
    onUndo,
    onSettingsChanged,
    onStatusUpdate,
  }: Props = $props();

  // Copilot connection state
  let copilotStatus = $state<CopilotStatus>('disconnected');
  let copilotAuth = $state<CopilotAuthStatus | null>(null);
  let copilotModels = $state<CopilotModel[]>([]);
  let copilotError = $state("");
  let copilotSelectedModel = $state("");

  // Enhancer templates
  let enhancerTemplates = $state<EnhancerTemplate[]>([]);
  let selectedEnhancerId = $state("");

  let sortedCopilotModels = $derived([...copilotModels].sort((a, b) => a.name.localeCompare(b.name)));

  let enhanceButtonLabel = $derived.by(() => {
    if (enhancing) return "Enhancing...";
    if (status === "listening") return "Stop Mic & Enhance";
    return "Enhance";
  });

  // Expose status changes to parent for titlebar avatar display
  $effect(() => {
    onStatusUpdate?.(copilotStatus, copilotAuth);
  });

  // Auto-connect to Copilot when enabled.
  // Read copilotStatus via untrack() so writing to it inside the effect
  // doesn't retrigger the effect and stale-cancel the in-flight async chain.
  $effect(() => {
    const enabled = settings.copilot_enabled;
    const currentStatus = untrack(() => copilotStatus);
    let stale = false;
    if (enabled && currentStatus === 'disconnected') {
      copilotStatus = 'connecting';
      copilotError = '';
      (async () => {
        try {
          await copilotInit();
          if (stale) return;
          const auth = await copilotAuthStatus();
          if (stale) return;
          copilotAuth = auth;
          if (auth?.authenticated) {
            copilotModels = await copilotListModels();
            if (stale) return;
            copilotStatus = 'connected';
            if (settings.copilot_selected_model && copilotModels.some(m => m.id === settings.copilot_selected_model)) {
              copilotSelectedModel = settings.copilot_selected_model;
            }
          } else {
            copilotStatus = 'error';
            copilotError = 'Not signed in to GitHub Copilot';
          }
        } catch (e: any) {
          if (stale) return;
          copilotStatus = 'error';
          copilotError = String(e);
        }
        if (stale) return;
        enhancerTemplates = await getEnhancerTemplates();
        if (stale) return;
        const savedEnhancer = settings.copilot_selected_enhancer;
        if (savedEnhancer && enhancerTemplates.some(t => t.id === savedEnhancer)) {
          selectedEnhancerId = savedEnhancer;
        } else if (enhancerTemplates.length > 0) {
          selectedEnhancerId = enhancerTemplates[0].id;
        }
      })();
    } else if (!enabled && currentStatus !== 'disconnected') {
      copilotStop().catch(e => console.error("Failed to stop Copilot:", e));
      copilotStatus = 'disconnected';
      copilotAuth = null;
      copilotModels = [];
      copilotError = '';
    }
    return () => { stale = true; };
  });

  // Listen to enhancer-templates-updated from Settings
  $effect(() => {
    let unlisten: (() => void) | null = null;
    listen(EVENT_ENHANCER_TEMPLATES_UPDATED, async () => {
      enhancerTemplates = await getEnhancerTemplates();
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  });

  async function handleModelChange(modelId: string) {
    copilotSelectedModel = modelId;
    const updated = { ...settings, copilot_selected_model: modelId };
    (document.activeElement as HTMLElement)?.blur();
    onSettingsChanged(updated);
    try {
      await saveSettings(updated);
      await emit(EVENT_SETTINGS_UPDATED);
    } catch (e) {
      console.error("Failed to persist model selection:", e);
    }
  }

  async function handleEnhancerChange(enhancerId: string) {
    selectedEnhancerId = enhancerId;
    const updated = { ...settings, copilot_selected_enhancer: enhancerId };
    (document.activeElement as HTMLElement)?.blur();
    onSettingsChanged(updated);
    try {
      await saveSettings(updated);
      await emit(EVENT_SETTINGS_UPDATED);
    } catch (e) {
      console.error("Failed to persist enhancer selection:", e);
    }
  }

  function handleEnhanceClick() {
    if (enhancing || !editedText.trim() || !copilotSelectedModel || !selectedEnhancerId || copilotStatus !== 'connected') return;
    const template = enhancerTemplates.find(t => t.id === selectedEnhancerId);
    if (!template) return;
    onEnhance(copilotSelectedModel, template.text);
  }

  export function getEnhancerTemplatesList(): EnhancerTemplate[] {
    return enhancerTemplates;
  }

  export function isConnected(): boolean {
    return copilotStatus === 'connected';
  }

  /** Programmatically trigger enhancement (used by keyboard shortcut). */
  export function triggerEnhance(): void {
    handleEnhanceClick();
  }
</script>

{#if settings.copilot_enabled && copilotStatus === 'connected' && enhancerTemplates.length > 0}
  <div class="copilot-inline">
    <select class="copilot-select" value={copilotSelectedModel} onchange={(e) => handleModelChange((e.target as HTMLSelectElement).value)} disabled={enhancing} title="Select Copilot model">
      <option value="">Model...</option>
      {#each sortedCopilotModels as model}
        <option value={model.id}>{model.name}{model.is_premium ? ` (${model.multiplier}x)` : ' (Included)'}</option>
      {/each}
    </select>
    <select class="copilot-select" value={selectedEnhancerId} onchange={(e) => handleEnhancerChange((e.target as HTMLSelectElement).value)} disabled={enhancing} title="Select prompt enhancer template">
      <option value="">Enhancer...</option>
      {#each enhancerTemplates as t}
        <option value={t.id}>{t.name}</option>
      {/each}
    </select>
    {#if enhanceUndoStackSize > 0}
      <button
        class="copilot-undo-btn"
        onclick={onUndo}
        title="Undo enhancement (Ctrl+Z)"
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
        <span class="copilot-enhance-label">Undo</span>
      </button>
    {/if}
    <button
      class="copilot-enhance-btn"
      onclick={handleEnhanceClick}
      disabled={enhancing || !editedText.trim() || !copilotSelectedModel || !selectedEnhancerId}
      title={enhancing ? 'Enhancing...' : status === 'listening' ? 'Stop microphone and enhance prompt' : 'Enhance prompt with AI'}
    >
      {#if enhancing}
        <svg class="spin" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
      {:else}
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4V2"/><path d="M15 16v-2"/><path d="M8 9h2"/><path d="M20 9h2"/><path d="M17.8 11.8L19 13"/><path d="M15 9h.01"/><path d="M17.8 6.2L19 5"/><path d="M11 6.2L9.8 5"/><path d="M6.87 20.13l-2-2"/><path d="M12.07 14.93l-6.6 6.6"/><path d="M5.47 19.53l2-2"/></svg>
      {/if}
      <span class="copilot-enhance-label">{enhanceButtonLabel}</span>
    </button>
  </div>
  {#if copilotError}
    <div class="copilot-error">
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      {copilotError}
      <button class="copilot-error-dismiss" onclick={() => copilotError = ''}>✕</button>
    </div>
  {/if}
{/if}
