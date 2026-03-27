// ---------------------------------------------------------------------------
// Shared types for AI providers
// ---------------------------------------------------------------------------

import type { CanStartResult } from "../speech/registry";

export type { CanStartResult };

// ---------------------------------------------------------------------------
// Capability flags — used by UI to enable features without checking IDs
// ---------------------------------------------------------------------------

export type AIProviderCapability =
  | "streaming"         // Provider supports token-by-token streaming
  | "requires-auth"     // Requires external authentication (e.g. GitHub login)
  | "requires-backend"  // Needs Rust-side process management
  | "local-model";      // Uses locally running model (Ollama, etc.)

// ---------------------------------------------------------------------------
// Request / Response types
// ---------------------------------------------------------------------------

export interface AICompletionRequest {
  /** System prompt (enhancement instructions). */
  systemPrompt: string;
  /** User text to enhance. */
  userText: string;
  /** Model identifier (provider-specific). */
  model?: string;
}

export interface AICompletionResponse {
  /** The enhanced/completed text. */
  text: string;
}

// ---------------------------------------------------------------------------
// Streaming callbacks (for providers that support streaming)
// ---------------------------------------------------------------------------

export interface AIStreamCallbacks {
  /** Called for each new token received. */
  onToken: (token: string) => void;
  /** Called when the full response is complete. */
  onComplete: (fullText: string) => void;
  /** Called on error during streaming. */
  onError: (error: string) => void;
}

// ---------------------------------------------------------------------------
// Window indicator — shown in the titlebar when provider is active
// ---------------------------------------------------------------------------

export interface AIProviderIndicator {
  /** Short label, e.g. username or provider name. */
  label: string;
  /** Icon URL for dark theme backgrounds. */
  imageUrlDark?: string;
  /** Icon URL for light theme backgrounds. */
  imageUrlLight?: string;
}

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

export interface AIProvider {
  /**
   * Send a completion request and return the full response.
   * Providers handle their own lifecycle (per-call client creation, etc.).
   */
  complete(request: AICompletionRequest): Promise<AICompletionResponse>;

  /**
   * Optional: stream a completion response token-by-token.
   * Only available on providers with the `streaming` capability.
   */
  completeStream?(request: AICompletionRequest, callbacks: AIStreamCallbacks): Promise<void>;

  /**
   * Check whether the provider is ready to accept requests.
   * May be async (e.g. checking auth status over IPC).
   */
  isReady(): boolean | Promise<boolean>;

  /**
   * Optional: get an active indicator for the window titlebar.
   * Returns provider-specific info (e.g. user avatar, provider badge)
   * or null if no indicator should be shown.
   */
  getIndicator?(): Promise<AIProviderIndicator | null>;

  /** Clean up resources. No-op for per-call providers. */
  dispose?(): void;
}
