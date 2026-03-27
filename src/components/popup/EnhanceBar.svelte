<script lang="ts">
  import { listen, emit } from "@tauri-apps/api/event";
  import type { AppSettings } from "../../lib/settingsStore";
  import { saveSettings } from "../../lib/settingsStore";
  import {
    EVENT_SETTINGS_UPDATED,
    EVENT_ENHANCER_TEMPLATES_UPDATED,
    type RecordingStatus,
  } from "../../lib/constants";
  import { aiProviderRegistry } from "../../lib/ai/aiService";
  import type { AIProviderIndicator } from "../../lib/ai/aiService";
  import { copilotListModels, type CopilotModel } from "../../lib/copilotStore";
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
    onStatusUpdate?: (ready: boolean, indicator: AIProviderIndicator | null) => void;
  }

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

  // Provider state
  let providerReady = $state(false);
  let providerIndicator = $state<AIProviderIndicator | null>(null);
  let copilotModels = $state<CopilotModel[]>([]);
  let enhanceError = $state("");
  let selectedModel = $state("");

  // Enhancer templates
  let enhancerTemplates = $state<EnhancerTemplate[]>([]);
  let selectedEnhancerId = $state("");

  let sortedModels = $derived([...copilotModels].sort((a, b) => a.name.localeCompare(b.name)));

  let isCopilot = $derived(settings.ai_provider === "copilot");

  let enhanceButtonLabel = $derived.by(() => {
    if (enhancing) return "Enhancing...";
    if (status === "listening") return "Stop Mic & Enhance";
    return "Enhance";
  });

  // Notify parent of status changes
  $effect(() => {
    onStatusUpdate?.(providerReady, providerIndicator);
  });

  // Check provider readiness when AI is enabled and provider changes
  $effect(() => {
    const enabled = settings.ai_enabled;
    const providerId = settings.ai_provider;
    let stale = false;

    if (enabled) {
      enhanceError = "";
      (async () => {
        try {
          // Load enhancer templates
          enhancerTemplates = await getEnhancerTemplates();
          if (stale) return;

          const savedEnhancer = settings.ai_selected_enhancer;
          if (savedEnhancer && enhancerTemplates.some(t => t.id === savedEnhancer)) {
            selectedEnhancerId = savedEnhancer;
          } else if (enhancerTemplates.length > 0) {
            selectedEnhancerId = enhancerTemplates[0].id;
          }

          // Check readiness and indicator
          const plugin = aiProviderRegistry.get(providerId);
          if (!plugin) {
            providerReady = false;
            enhanceError = `Unknown AI provider: ${providerId}`;
            return;
          }

          const config = settings.ai_provider_configs?.[providerId] ?? plugin.defaultConfig();
          const provider = plugin.createProvider(config);
          const ready = await provider.isReady();
          if (stale) return;

          if (!ready) {
            providerReady = false;
            enhanceError = "Provider not ready";
            return;
          }

          // Fetch window indicator (avatar, badge, etc.)
          if (provider.getIndicator) {
            providerIndicator = await provider.getIndicator();
            if (stale) return;
          } else {
            providerIndicator = null;
          }

          // Copilot-specific: load model list
          if (providerId === "copilot") {
            copilotModels = await copilotListModels();
            if (stale) return;
            const savedModel = (config.selected_model as string) ?? "";
            selectedModel = copilotModels.some(m => m.id === savedModel) ? savedModel : "";
          }

          providerReady = true;
        } catch (e: any) {
          if (stale) return;
          providerReady = false;
          enhanceError = String(e);
        }
      })();
    } else {
      providerReady = false;
      providerIndicator = null;
      copilotModels = [];
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
    selectedModel = modelId;
    const configs = { ...settings.ai_provider_configs };
    configs.copilot = { ...(configs.copilot ?? {}), selected_model: modelId };
    const updated = { ...settings, ai_provider_configs: configs };
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
    const updated = { ...settings, ai_selected_enhancer: enhancerId };
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
    if (enhancing || !editedText.trim() || !providerReady || !selectedEnhancerId) return;
    if (isCopilot && !selectedModel) return;
    const template = enhancerTemplates.find(t => t.id === selectedEnhancerId);
    if (!template) return;
    onEnhance(selectedModel, template.text);
  }

  export function getEnhancerTemplatesList(): EnhancerTemplate[] {
    return enhancerTemplates;
  }

  export function isConnected(): boolean {
    return providerReady;
  }

  export function triggerEnhance(): void {
    handleEnhanceClick();
  }
</script>

{#if settings.ai_enabled && providerReady && enhancerTemplates.length > 0}
  <div class="copilot-inline">
    {#if isCopilot}
      <select class="copilot-select" value={selectedModel} onchange={(e) => handleModelChange((e.target as HTMLSelectElement).value)} disabled={enhancing} title="Select AI model">
        <option value="">Model...</option>
        {#each sortedModels as model}
          <option value={model.id}>{model.name}{model.is_premium ? ` (${model.multiplier}x)` : ' (Included)'}</option>
        {/each}
      </select>
    {/if}
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
      disabled={enhancing || !editedText.trim() || (isCopilot && !selectedModel) || !selectedEnhancerId}
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
  {#if enhanceError}
    <div class="copilot-error">
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      {enhanceError}
      <button class="copilot-error-dismiss" onclick={() => enhanceError = ''}>✕</button>
    </div>
  {/if}
{/if}
