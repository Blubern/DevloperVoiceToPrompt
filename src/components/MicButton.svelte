<script lang="ts">
  interface Props {
    status: "idle" | "starting" | "listening" | "error";
    onToggle: () => void;
    disabled?: boolean;
  }

  let { status, onToggle, disabled = false }: Props = $props();
</script>

<button
  class="mic-button"
  class:listening={status === "listening"}
  class:starting={status === "starting"}
  class:error={status === "error"}
  class:idle={status === "idle"}
  class:disabled={disabled}
  onclick={onToggle}
  {disabled}
  aria-label={status === "listening" ? "Stop dictation" : status === "starting" ? "Starting..." : "Start dictation"}
  title={disabled ? "Enhancement in progress" : status === "listening" ? "Click to stop" : status === "starting" ? "Starting microphone..." : "Click to start dictation"}
>
  <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" y1="19" x2="12" y2="23" />
    <line x1="8" y1="23" x2="16" y2="23" />
  </svg>

  {#if status === "listening"}
    <span class="pulse-ring"></span>
    <span class="pulse-ring delay"></span>
  {/if}
  {#if status === "starting"}
    <span class="starting-ring"></span>
  {/if}
</button>

<style>
  .mic-button {
    position: relative;
    width: 52px;
    height: 52px;
    border-radius: 50%;
    border: 2px solid var(--border);
    background: var(--bg-secondary);
    color: var(--text-primary);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
    flex-shrink: 0;
  }

  .mic-button:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  .mic-button.disabled {
    opacity: 0.4;
    cursor: not-allowed;
    pointer-events: none;
  }

  .mic-button.idle {
    border-color: var(--accent);
    color: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 10%, transparent);
  }

  .mic-button.idle:hover {
    box-shadow: 0 0 0 5px color-mix(in srgb, var(--accent) 15%, transparent);
  }

  .mic-button.listening {
    border-color: var(--recording);
    color: var(--recording);
    background: var(--mic-listening-bg);
  }

  .mic-button.error {
    border-color: var(--orange);
    color: var(--orange);
  }

  .mic-button.starting {
    border-color: var(--accent);
    color: var(--accent);
    opacity: 0.8;
  }

  .starting-ring {
    position: absolute;
    inset: -4px;
    border-radius: 50%;
    border: 2px solid transparent;
    border-top-color: var(--accent);
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .pulse-ring {
    position: absolute;
    inset: -4px;
    border-radius: 50%;
    border: 2px solid var(--recording);
    opacity: 0;
    animation: pulse 2s ease-out infinite;
  }

  .pulse-ring.delay {
    animation-delay: 0.5s;
  }

  @keyframes pulse {
    0% {
      opacity: 0.6;
      transform: scale(0.95);
    }
    100% {
      opacity: 0;
      transform: scale(1.4);
    }
  }
</style>
