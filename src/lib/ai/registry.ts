// ---------------------------------------------------------------------------
// AI Provider Plugin Registry
// ---------------------------------------------------------------------------
//
// Each AI service is packaged as a plugin that self-describes its
// capabilities, settings component, and factory. The registry replaces all
// hardcoded provider lists in the codebase.
// ---------------------------------------------------------------------------

import type { AIProvider, AIProviderCapability, CanStartResult } from "./types";
import type { Component } from "svelte";

// ---------------------------------------------------------------------------
// Settings tab props — standard interface for all AI settings sub-tabs
// ---------------------------------------------------------------------------

export interface AISettingsTabProps {
  config: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Plugin interface
// ---------------------------------------------------------------------------

export interface AIProviderPlugin {
  /** Unique provider identifier, e.g. "copilot", "openai", "ollama". */
  readonly id: string;
  /** Human-readable label shown in the UI, e.g. "GitHub Copilot". */
  readonly label: string;
  /** Short description of the provider. */
  readonly description?: string;

  /** Capability flags for UI feature gating. */
  readonly capabilities: ReadonlySet<AIProviderCapability>;

  /** Create a provider instance from its per-provider config. */
  createProvider(config: Record<string, unknown>): AIProvider;

  /** Return default config values for this provider. */
  defaultConfig(): Record<string, unknown>;

  /**
   * Synchronous check whether the provider can start.
   * Returns `{ ready: true }` or `{ ready: false, error: "..." }`.
   */
  canStart(config: Record<string, unknown>): CanStartResult;

  /**
   * Optional async validation (e.g. auth check, server reachability).
   * When present, used instead of canStart().
   */
  canStartAsync?(config: Record<string, unknown>): Promise<CanStartResult>;

  /** Svelte 5 component rendered inside the AI settings tab. */
  readonly SettingsComponent: Component<AISettingsTabProps>;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

class AIProviderRegistry {
  private plugins: Map<string, AIProviderPlugin> = new Map();
  private order: string[] = [];

  /** Register a plugin. Registration order determines UI tab order. */
  register(plugin: AIProviderPlugin): void {
    if (this.plugins.has(plugin.id)) {
      throw new Error(`AI provider "${plugin.id}" is already registered.`);
    }
    this.plugins.set(plugin.id, plugin);
    this.order.push(plugin.id);
  }

  /** Get a plugin by ID, or undefined if not found. */
  get(id: string): AIProviderPlugin | undefined {
    return this.plugins.get(id);
  }

  /** Get all registered plugins in registration order. */
  getAll(): AIProviderPlugin[] {
    return this.order.map((id) => this.plugins.get(id)!);
  }

  /** Get all registered provider IDs in order. */
  getIds(): string[] {
    return [...this.order];
  }

  /** Get the display label for a provider ID. */
  getLabel(id: string): string {
    return this.plugins.get(id)?.label ?? id;
  }

  /** Number of registered plugins. */
  get size(): number {
    return this.plugins.size;
  }
}

/** Singleton registry — plugins register at import time. */
export const aiProviderRegistry = new AIProviderRegistry();
