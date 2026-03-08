<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { writeText } from "@tauri-apps/plugin-clipboard-manager";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { load, type Store } from "@tauri-apps/plugin-store";
  import type { AppSettings } from "../lib/settingsStore";
  import {
    SUPPORTED_LANGUAGES,
    saveSettings,
  } from "../lib/settingsStore";
  import {
    createSpeechProvider,
    checkMicrophonePermission,
    webSpeechAvailable,
    enumerateAudioDevices,
    type SpeechCallbacks,
    type SpeechProvider,
    type AudioDevice,
  } from "../lib/speechService";
  import { recordUsage } from "../lib/usageStore";
  import { addHistoryEntry, getHistory, deleteHistoryEntry, type HistoryEntry } from "../lib/historyStore";
  import { getTemplates, addTemplate, type PromptTemplate } from "../lib/templateStore";
  import { listen, emit } from "@tauri-apps/api/event";
  import MicButton from "./MicButton.svelte";
  import HelpOverlay from "./popup/HelpOverlay.svelte";
  import AboutOverlay from "./popup/AboutOverlay.svelte";
  import TemplatesPanel from "./popup/TemplatesPanel.svelte";
  import HistoryPanel from "./popup/HistoryPanel.svelte";
  import {
    PROVIDER_AZURE,
    PROVIDER_OS,
    PROVIDER_WHISPER,
    cycleProvider,
    providerLabel,
    EVENT_SETTINGS_UPDATED,
    EVENT_TEMPLATES_UPDATED,
    EVENT_ENHANCER_TEMPLATES_UPDATED,
    EVENT_MCP_VOICE_REQUEST,
    ENHANCE_SYSTEM_PROMPT_WRAPPER,
    type RecordingStatus,
    type McpVoiceRequest,
  } from "../lib/constants";
  import { matchesShortcut, formatShortcutLabel } from "../lib/useKeyboardShortcuts";
  import { AudioLevelMeter } from "../lib/audioLevelMeter";
  import { copilotInit, copilotAuthStatus, copilotListModels, copilotStop, copilotEnhance, type CopilotAuthStatus, type CopilotModel } from "../lib/copilotStore";
  import { getEnhancerTemplates, type EnhancerTemplate } from "../lib/enhancerTemplateStore";

  interface Props {
    settings: AppSettings;
  }

  let { settings }: Props = $props();

  const isMac = navigator.userAgent.toLowerCase().includes('macintosh') || navigator.platform.toLowerCase().includes('mac');

  let status = $state<RecordingStatus>("idle");
  let finalSegments = $state<string[]>([]);
  let interimText = $state("");
  let errorMessage = $state("");
  let textareaEl: HTMLTextAreaElement | undefined = $state();

  // Track user's edited text separately from speech output
  let editedText = $state("");
  let userHasEdited = $state(false);
  let lastSyncedSegmentCount = $state(0);

  // Cursor position tracking for insert-at-cursor during dictation
  let cursorPosition = $state(0);

  // Usage tracking: record start time of current recognition session
  let sessionStartTime: number | null = null;
  let activeProvider: SpeechProvider | null = null;

  // Audio level meter
  let audioLevel = $state(0);
  let levelMeter: AudioLevelMeter | null = null;

  // Silence auto-stop timer
  let silenceTimer: ReturnType<typeof setTimeout> | null = null;
  let silenceMessage = $state("");
  let silenceMessageFading = $state(false);

  // Max recording time timer
  let maxRecordingTimer: ReturnType<typeof setTimeout> | null = null;

  // Window resize/move debounce
  let resizeDebounce: ReturnType<typeof setTimeout> | null = null;

  // Auto-start timer
  let autoStartTimer: ReturnType<typeof setTimeout> | null = null;

  // History panel
  let historyOpen = $state(false);
  let historyEntries = $state<HistoryEntry[]>([]);
  let historyCount = $state(0);
  let historySearch = $state("");

  // Help / About overlays
  let helpOpen = $state(false);
  let aboutOpen = $state(false);

  // Templates
  let templatesOpen = $state(false);
  let templateEntries = $state<PromptTemplate[]>([]);
  let templateSaveTriggered = $state(false);
  let showTemplateSavedToast = $state(false);

  // Copied toast
  let showCopiedToast = $state(false);

  // Undo clear
  let undoSnapshot: { segments: string[]; text: string; wasEdited: boolean; syncCount: number } | null = $state(null);
  let showUndoToast = $state(false);
  let undoTimer: ReturnType<typeof setTimeout> | null = null;

  // Copilot state
  let copilotStatus = $state<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
  let copilotAuth = $state<CopilotAuthStatus | null>(null);
  let copilotModels = $state<CopilotModel[]>([]);
  let copilotError = $state("");
  let copilotSelectedModel = $state("");
  let enhancerTemplates = $state<EnhancerTemplate[]>([]);
  let selectedEnhancerId = $state("");
  let enhancing = $state(false);

  // Whisper model download check
  let whisperModelMissing = $state(false);

  // Enhancement undo stack (multi-level, resets on copy/close and clear)
  let enhanceUndoStack = $state<string[]>([]);
  let showEnhanceToast = $state(false);
  let enhanceToastTimer: ReturnType<typeof setTimeout> | null = null;

  // MCP mode: set when the popup was opened by an MCP tool call
  let mcpRequest = $state<McpVoiceRequest | null>(null);

  let sortedCopilotModels = $derived([...copilotModels].sort((a, b) => a.name.localeCompare(b.name)));

  let isMcpMode = $derived(mcpRequest !== null);
  let showEmptyState = $derived(!editedText && status === "idle");

  // Elapsed time display
  let elapsedSeconds = $state(0);
  let elapsedInterval: ReturnType<typeof setInterval> | null = null;

  // Re-entrancy guard for toggleMic
  let toggling = false;

  // Whisper decode ring + latency badge
  let decodeLatencyMs = $state(0);
  let decodeProgress = $state(0);
  let decodeCycleDuration = $state(1000);
  let decodeActive = $state(false);
  let decodeRafId: number | null = null;
  let decodeCycleStart = 0;
  let decodeFadeTimer: ReturnType<typeof setTimeout> | null = null;

  // Language dropdown state
  let langDropdownOpen = $state(false);
  let langDropdownFilter = $state("");

  let filteredPopupLanguages = $derived(
    langDropdownFilter.trim()
      ? SUPPORTED_LANGUAGES.filter(
          (l) =>
            l.label.toLowerCase().includes(langDropdownFilter.trim().toLowerCase()) ||
            l.code.toLowerCase().includes(langDropdownFilter.trim().toLowerCase())
        )
      : SUPPORTED_LANGUAGES
  );

  // Auto-scroll tracking
  let userScrolledUp = false;

  // Microphone selector
  let micDropdownOpen = $state(false);
  let audioDevices = $state<AudioDevice[]>([]);
  let micWarning = $state("");
  let selectedMicLabel = $derived(() => {
    if (!settings.microphone_device_id) return "Default Mic";
    const dev = audioDevices.find(d => d.deviceId === settings.microphone_device_id);
    return dev ? dev.label : "Default Mic";
  });

  // Language labels for display: "Name (code)" format
  let languageDisplayLabels = $derived(
    settings.languages.map((code) => {
      const lang = SUPPORTED_LANGUAGES.find((l) => l.code === code);
      return lang ? `${lang.label.split(" ")[0]} (${code})` : code;
    })
  );

  // OS language display label
  let osLanguageDisplayLabel = $derived(() => {
    const lang = SUPPORTED_LANGUAGES.find((l) => l.code === settings.os_language);
    return lang ? `${lang.label.split(" ")[0]} (${settings.os_language})` : settings.os_language;
  });

  let whisperLanguageDisplayLabel = $derived(() => {
    const lang = SUPPORTED_LANGUAGES.find((l) => l.code === settings.whisper_language);
    return lang ? `${lang.label.split(" ")[0]} (${settings.whisper_language})` : settings.whisper_language;
  });

  // Map font setting to CSS font-family
  const FONT_FAMILIES: Record<string, string> = {
    mono: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Consolas', 'Courier New', monospace",
    cascadia: "'Cascadia Code', 'Cascadia Mono', monospace",
    firacode: "'Fira Code', 'Fira Mono', monospace",
    jetbrains: "'JetBrains Mono', monospace",
    consolas: "'Consolas', monospace",
    courier: "'Courier New', monospace",
    ubuntu: "'Ubuntu Mono', monospace",
    system: "system-ui, -apple-system, 'Segoe UI', sans-serif",
    georgia: "'Georgia', serif",
    palatino: "'Palatino Linotype', 'Book Antiqua', Palatino, serif",
    garamond: "'Garamond', 'EB Garamond', serif",
    serif: "'Georgia', 'Times New Roman', serif",
  };
  let popupFontFamily = $derived(FONT_FAMILIES[settings.popup_font] ?? FONT_FAMILIES.mono);

  // Context-aware button label
  let primaryButtonLabel = $derived.by(() => {
    const hasText = editedText.trim().length > 0;
    if (isMcpMode) {
      if (status === "listening" && hasText) return "Stop Mic & Submit";
      if (status === "listening" && !hasText) return "Stop Mic";
      if (hasText) return "Submit to MCP";
      return "Submit to MCP";
    }
    if (status === "listening" && hasText) return "Stop Mic, Copy & Close";
    if (status === "listening" && !hasText) return "Stop Mic";
    if (hasText) return "Copy & Close";
    return "Copy & Close";
  });

  // Enhance button label: context-aware based on mic state
  let enhanceButtonLabel = $derived.by(() => {
    if (enhancing) return "Enhancing...";
    if (status === "listening") return "Stop Mic & Enhance";
    return "Enhance";
  });

  // Format elapsed time as m:ss
  function formatElapsed(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  $effect(() => {
    const segmentCount = finalSegments.length;
    const currentInterim = interimText;

    if (!userHasEdited) {
      editedText =
        finalSegments.join(" ") +
        (currentInterim ? (segmentCount ? " " : "") + currentInterim : "");
      cursorPosition = editedText.length;
      lastSyncedSegmentCount = segmentCount;
    } else if (segmentCount > lastSyncedSegmentCount) {
      const newSegments = finalSegments.slice(lastSyncedSegmentCount);
      if (newSegments.length > 0) {
        const addition = newSegments.join(" ");
        const pos = cursorPosition;
        const before = editedText.slice(0, pos);
        const after = editedText.slice(pos);
        const needsSpace = before.length > 0 && !before.endsWith(" ") && !before.endsWith("\n");
        const insertText = (needsSpace ? " " : "") + addition;
        editedText = before + insertText + after;
        cursorPosition = pos + insertText.length;
      }
      lastSyncedSegmentCount = segmentCount;
    }
  });

  // Restore cursor position and scroll after reactive text updates during recording
  $effect(() => {
    const _ = editedText;
    if (textareaEl && status === "listening" && userHasEdited) {
      const savedScroll = textareaEl.scrollTop;
      requestAnimationFrame(() => {
        if (textareaEl) {
          textareaEl.selectionStart = cursorPosition;
          textareaEl.selectionEnd = cursorPosition;
          // Keep scroll stable when cursor is not at the end
          if (cursorPosition < editedText.length) {
            textareaEl.scrollTop = savedScroll;
          }
        }
      });
    }
  });

  // Auto-scroll textarea to bottom on new text (only when cursor is at the end)
  $effect(() => {
    // Track editedText changes
    const _ = editedText;
    if (textareaEl && !userScrolledUp && cursorPosition >= editedText.length) {
      requestAnimationFrame(() => {
        if (textareaEl) {
          textareaEl.scrollTop = textareaEl.scrollHeight;
        }
      });
    }
  });

  // Track if user scrolled up manually
  function handleTextareaScroll() {
    if (!textareaEl) return;
    const { scrollTop, scrollHeight, clientHeight } = textareaEl;
    userScrolledUp = scrollHeight - scrollTop - clientHeight > 30;
  }

  // Elapsed timer for recording state
  $effect(() => {
    if (status === "listening") {
      elapsedSeconds = 0;
      elapsedInterval = setInterval(() => {
        elapsedSeconds += 1;
      }, 1000);
    } else {
      if (elapsedInterval) {
        clearInterval(elapsedInterval);
        elapsedInterval = null;
      }
    }
    return () => {
      if (elapsedInterval) {
        clearInterval(elapsedInterval);
        elapsedInterval = null;
      }
    };
  });

  // Persist window size and position on resize/move
  $effect(() => {
    const win = getCurrentWindow();
    const unlisteners: Array<() => void> = [];

    async function saveGeometry() {
      try {
        const size = await win.innerSize();
        const pos = await win.outerPosition();
        const sf = await win.scaleFactor();
        const s: Store = await load("settings.json");
        await s.set("popup_width", size.width / sf);
        await s.set("popup_height", size.height / sf);
        await s.set("popup_x", pos.x / sf);
        await s.set("popup_y", pos.y / sf);
      } catch (e) {
        console.error("Failed to save popup geometry:", e);
      }
    }

    function debouncedSave() {
      if (resizeDebounce) clearTimeout(resizeDebounce);
      resizeDebounce = setTimeout(saveGeometry, 300);
    }

    win.onResized(() => debouncedSave()).then((u) => unlisteners.push(u));
    win.onMoved(() => debouncedSave()).then((u) => unlisteners.push(u));

    // Refresh history when window regains focus
    win.onFocusChanged(({ payload: focused }) => {
      if (focused && historyOpen && settings.history_enabled) {
        getHistory().then(entries => {
          historyEntries = entries;
          historyCount = entries.length;
        }).catch(e => console.error("Failed to refresh history on focus:", e));
      }
    }).then((u) => unlisteners.push(u));

    return () => {
      unlisteners.forEach((u) => u());
      if (resizeDebounce) clearTimeout(resizeDebounce);
    };
  });

  // Load history count for badge
  $effect(() => {
    if (settings.history_enabled) {
      getHistory().then(entries => { historyCount = entries.length; }).catch(e => console.error("Failed to load history count:", e));
    } else {
      historyCount = 0;
    }
  });

  // Auto-start recording when popup opens / regains focus
  let autoStartDone = $state(false);

  // Reset auto-start flag when popup regains focus (popup is show/hide, not recreated)
  $effect(() => {
    const win = getCurrentWindow();
    let unlisten: (() => void) | null = null;
    win.onFocusChanged(({ payload: focused }) => {
      if (focused && settings.auto_start_recording && status === "idle" && !editedText) {
        autoStartDone = false;
      }
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  });

  $effect(() => {
    if (settings.auto_start_recording && status === "idle" && !editedText && !autoStartDone) {
      // Check provider config validity before auto-starting
      const canStart =
        (settings.speech_provider === PROVIDER_AZURE && settings.azure_speech_key && settings.azure_region) ||
        (settings.speech_provider === PROVIDER_OS && webSpeechAvailable) ||
        (settings.speech_provider === PROVIDER_WHISPER && settings.whisper_model && !whisperModelMissing);
      if (canStart) {
        autoStartDone = true;
        // Slight delay to let the popup fully render
        autoStartTimer = setTimeout(() => toggleMic(), 150);
      }
    }
    return () => {
      if (autoStartTimer) { clearTimeout(autoStartTimer); autoStartTimer = null; }
    };
  });

  // Check if selected Whisper model is downloaded; auto-select a downloaded one if not.
  $effect(() => {
    if (settings.speech_provider === PROVIDER_WHISPER) {
      let stale = false;
      invoke<{ name: string; downloaded: boolean }[]>("whisper_list_models").then((models) => {
        if (stale) return;
        const selected = models.find((m) => m.name === settings.whisper_model);
        if (selected?.downloaded) {
          whisperModelMissing = false;
          return;
        }
        // Current model is missing or unset – pick the first downloaded model instead.
        const available = models.find((m) => m.downloaded);
        if (available) {
          settings = { ...settings, whisper_model: available.name };
          saveSettings(settings).catch(e => console.error("Failed to save whisper model fallback:", e));
          whisperModelMissing = false;
        } else {
          whisperModelMissing = !!settings.whisper_model;
        }
      }).catch(() => {
        if (!stale) whisperModelMissing = false;
      });
      return () => { stale = true; };
    } else {
      whisperModelMissing = false;
    }
  });

  // Close language dropdown when recording starts
  $effect(() => {
    if (status === "listening") {
      langDropdownOpen = false;
    }
  });

  function handleTextInput(e: Event) {
    const target = e.target as HTMLTextAreaElement;
    editedText = target.value;
    userHasEdited = true;
    cursorPosition = target.selectionStart;
  }

  function handleCursorChange() {
    if (textareaEl) {
      cursorPosition = textareaEl.selectionStart;
    }
  }

  function focusTextareaAtEnd() {
    requestAnimationFrame(() => {
      if (!textareaEl) return;
      textareaEl.focus();
      const caretPosition = editedText.length;
      textareaEl.selectionStart = caretPosition;
      textareaEl.selectionEnd = caretPosition;
      cursorPosition = caretPosition;
    });
  }

  function clearSilenceTimer() {
    if (silenceTimer) {
      clearTimeout(silenceTimer);
      silenceTimer = null;
    }
  }

  function clearMaxRecordingTimer() {
    if (maxRecordingTimer) {
      clearTimeout(maxRecordingTimer);
      maxRecordingTimer = null;
    }
  }

  // ----- Decode ring rAF loop -----
  function startDecodeRaf() {
    stopDecodeRaf();
    function tick() {
      const elapsed = performance.now() - decodeCycleStart;
      decodeProgress = Math.min(1, elapsed / decodeCycleDuration);
      decodeRafId = requestAnimationFrame(tick);
    }
    decodeRafId = requestAnimationFrame(tick);
  }

  function stopDecodeRaf() {
    if (decodeRafId !== null) { cancelAnimationFrame(decodeRafId); decodeRafId = null; }
    decodeProgress = 0;
    if (decodeFadeTimer) { clearTimeout(decodeFadeTimer); decodeFadeTimer = null; }
  }

  function startMaxRecordingTimer() {
    clearMaxRecordingTimer();
    if (settings.max_recording_enabled && settings.max_recording_seconds > 0) {
      maxRecordingTimer = setTimeout(async () => {
        silenceMessage = `Auto-stopped after ${settings.max_recording_seconds}s max recording time`;
        silenceMessageFading = false;
        await stopAndRecordUsage();
        setTimeout(() => {
          silenceMessageFading = true;
          setTimeout(() => { silenceMessage = ""; silenceMessageFading = false; }, 500);
        }, 3500);
      }, settings.max_recording_seconds * 1000);
    }
  }

  function resetSilenceTimer() {
    clearSilenceTimer();
    const timeout = settings.silence_timeout_seconds;
    if (timeout > 0 && status === "listening") {
      silenceTimer = setTimeout(async () => {
        silenceMessage = `Auto-paused after ${timeout}s of silence`;
        silenceMessageFading = false;
        await stopAndRecordUsage();
        setTimeout(() => {
          silenceMessageFading = true;
          setTimeout(() => { silenceMessage = ""; silenceMessageFading = false; }, 500);
        }, 3500);
      }, timeout * 1000);
    }
  }

  async function stopAndRecordUsage(skipFlush = false) {
    if (activeProvider) {
      await activeProvider.stop(skipFlush);
      activeProvider.dispose();
      activeProvider = null;
    }
    status = "idle";
    clearSilenceTimer();
    clearMaxRecordingTimer();
    if (levelMeter) {
      await levelMeter.stop();
      levelMeter = null;
    }
    audioLevel = 0;
    if (sessionStartTime !== null) {
      const elapsed = (Date.now() - sessionStartTime) / 1000;
      sessionStartTime = null;
      await recordUsage(elapsed, settings.speech_provider);
    }
  }

  async function toggleMic() {
    if (enhancing || toggling) return;
    toggling = true;
    try {
    if (status === "listening") {
      // Skip the final flush when the user is explicitly toggling off
      // (they may immediately restart), so stop returns faster.
      await stopAndRecordUsage(/* skipFlush */ true);
      return;
    }

    if (settings.speech_provider === PROVIDER_AZURE && (!settings.azure_speech_key || !settings.azure_region)) {
      errorMessage = "Azure Speech key not configured. Go to Settings → Speech.";
      return;
    }

    if (settings.speech_provider === PROVIDER_OS && !webSpeechAvailable) {
      errorMessage = "Web Speech API is not available in this browser.";
      return;
    }

    if (settings.speech_provider === PROVIDER_WHISPER && !settings.whisper_model) {
      errorMessage = "No Whisper model selected. Go to Settings → Speech → Whisper.";
      return;
    }

    if (settings.speech_provider === PROVIDER_WHISPER && whisperModelMissing) {
      errorMessage = "Selected Whisper model not downloaded. Go to Settings → Speech → Whisper to download it.";
      return;
    }

    const micPermission = await checkMicrophonePermission();
    if (micPermission === "denied") {
      errorMessage = "Microphone access denied. Check system privacy settings.";
      return;
    }

    errorMessage = "";
    silenceMessage = "";
    interimText = "";
    lastSyncedSegmentCount = finalSegments.length;
    userScrolledUp = false;

    const provider = createSpeechProvider(settings);

    const callbacks: SpeechCallbacks = {
      onInterim: (text) => {
        interimText = text;
        resetSilenceTimer();
      },
      onFinal: (text) => {
        if (text) {
          finalSegments = [...finalSegments, text];
          interimText = "";
          resetSilenceTimer();
        }
      },
      onError: (err) => {
        errorMessage = err;
      },
      onStatusChange: (s) => {
        status = s;
        if (s === "listening") {
          sessionStartTime = Date.now();
          resetSilenceTimer();
          startMaxRecordingTimer();
          if (settings.speech_provider === PROVIDER_WHISPER) {
            decodeCycleDuration = settings.whisper_decode_interval * 1000;
            decodeCycleStart = performance.now();
            decodeActive = true;
            startDecodeRaf();
          }
        } else {
          stopDecodeRaf();
          decodeActive = false;
        }
      },
      onDecodeStart: () => {
        decodeCycleStart = performance.now();
        decodeProgress = 0;
        decodeActive = true;
        if (decodeFadeTimer) { clearTimeout(decodeFadeTimer); decodeFadeTimer = null; }
      },
      onDecodeLatency: (ms: number) => {
        decodeLatencyMs = Math.round(ms);
        // Start fade timer — after 2s of no new decode, dim the ring
        if (decodeFadeTimer) clearTimeout(decodeFadeTimer);
        decodeFadeTimer = setTimeout(() => { decodeActive = false; }, 2000);
      },
      // Whisper provider computes audio level inline — no separate AudioLevelMeter needed.
      onAudioLevel: (level: number) => { audioLevel = level; },
    };

    activeProvider = provider;
    provider.start(callbacks);

    // For non-Whisper providers, start a standalone audio level meter.
    // Whisper reports audio level via the onAudioLevel callback above.
    if (settings.speech_provider !== PROVIDER_WHISPER) {
      levelMeter = new AudioLevelMeter();
      levelMeter.start((level) => { audioLevel = level; }, settings.microphone_device_id || undefined);
    }
    } finally {
      toggling = false;
    }
  }

  function clearText() {
    // Save snapshot for undo
    if (editedText.trim()) {
      undoSnapshot = {
        segments: [...finalSegments],
        text: editedText,
        wasEdited: userHasEdited,
        syncCount: lastSyncedSegmentCount,
      };
      showUndoToast = true;
      if (undoTimer) clearTimeout(undoTimer);
      undoTimer = setTimeout(() => {
        showUndoToast = false;
        undoSnapshot = null;
      }, 4000);
    }
    finalSegments = [];
    interimText = "";
    editedText = "";
    userHasEdited = false;
    lastSyncedSegmentCount = 0;
    cursorPosition = 0;
    userScrolledUp = false;
    // Clear enhancement undo stack
    enhanceUndoStack = [];
    showEnhanceToast = false;
    if (enhanceToastTimer) { clearTimeout(enhanceToastTimer); enhanceToastTimer = null; }
  }

  function undoClear() {
    if (!undoSnapshot) return;
    finalSegments = undoSnapshot.segments;
    editedText = undoSnapshot.text;
    userHasEdited = true;
    lastSyncedSegmentCount = undoSnapshot.syncCount;
    undoSnapshot = null;
    showUndoToast = false;
    if (undoTimer) { clearTimeout(undoTimer); undoTimer = null; }
  }

  async function copyToClipboard() {
    const text = editedText.trim();
    if (!text) return;
    try {
      await writeText(text);
      showCopiedToast = true;
      setTimeout(() => { showCopiedToast = false; }, 1800);
    } catch (e) {
      errorMessage = "Failed to copy to clipboard.";
    }
  }

  async function copyAndClose() {
    const text = editedText.trim();
    if (text) {
      await writeText(text);
      if (settings.history_enabled) {
        await addHistoryEntry(text, settings.history_max_entries, mcpRequest?.input_reason ?? undefined);
        // Refresh history if panel is open
        if (historyOpen) {
          historyEntries = await getHistory();
        }
        historyCount = Math.min(historyCount + 1, settings.history_max_entries);
      }
    }
    // Clear enhancement undo stack before clearText (which also clears it)
    enhanceUndoStack = [];
    showEnhanceToast = false;
    if (enhanceToastTimer) { clearTimeout(enhanceToastTimer); enhanceToastTimer = null; }
    if (status === "listening") {
      await stopAndRecordUsage();
    }
    // If open via MCP, send the result back to the caller
    if (mcpRequest !== null) {
      mcpRequest = null;
      await invoke("mcp_submit_result", { text: text || "" }).catch(e => console.error("Failed to submit MCP result:", e));
    }
    clearText();
    errorMessage = "";
    silenceMessage = "";
    status = "idle";
    if (activeProvider) { activeProvider.dispose(); activeProvider = null; }
    await invoke("hide_popup");
  }

  async function dismiss() {
    if (status === "listening") {
      await stopAndRecordUsage();
    }
    // If we were opened by an MCP call, cancel it so the caller gets an error
    if (mcpRequest !== null) {
      mcpRequest = null;
      await invoke("mcp_cancel").catch(e => console.error("Failed to cancel MCP request:", e));
    }
    clearText();
    errorMessage = "";
    silenceMessage = "";
    status = "idle";
    if (activeProvider) { activeProvider.dispose(); activeProvider = null; }
    await invoke("hide_popup");
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      if (aboutOpen) {
        aboutOpen = false;
      } else if (helpOpen) {
        helpOpen = false;
      } else if (templatesOpen) {
        templatesOpen = false;
      } else if (historyOpen) {
        historyOpen = false;
      } else {
        dismiss();
      }
    } else if (matchesShortcut(e, settings.popup_copy_shortcut)) {
      copyAndClose();
    } else if (matchesShortcut(e, settings.popup_voice_shortcut)) {
      e.preventDefault();
      toggleMic();
    } else if (matchesShortcut(e, settings.provider_switch_shortcut)) {
      e.preventDefault();
      if (status !== "listening") {
        settings = { ...settings, speech_provider: cycleProvider(settings.speech_provider) };
      }
    } else if (settings.prompt_enhancer_shortcut && matchesShortcut(e, settings.prompt_enhancer_shortcut)) {
      e.preventDefault();
      executeEnhance();
    } else if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && enhanceUndoStack.length > 0) {
      e.preventDefault();
      undoEnhance();
    }
  }

  async function toggleHistoryPanel() {
    if (!historyOpen) {
      historyEntries = await getHistory();
      historyCount = historyEntries.length;
      historySearch = "";
    }
    historyOpen = !historyOpen;
  }

  async function handleHistoryDelete(timestamp: string) {
    await deleteHistoryEntry(timestamp);
    historyEntries = await getHistory();
    historyCount = historyEntries.length;
  }

  function insertHistoryEntry(text: string) {
    editedText = text;
    userHasEdited = true;
    historyOpen = false;
  }

  // Template functions
  async function toggleTemplatesPanel() {
    if (!templatesOpen) {
      templateEntries = await getTemplates();
    }
    templatesOpen = !templatesOpen;
  }

  async function triggerSaveTemplate() {
    if (!templatesOpen) {
      templateEntries = await getTemplates();
      templatesOpen = true;
    }
    templateSaveTriggered = true;
  }

  function selectTemplate(t: PromptTemplate) {
    editedText = t.text.replace(/\r\n/g, "\n");
    userHasEdited = true;
    templatesOpen = false;
    cursorPosition = editedText.length;
  }

  async function saveAsTemplate(name: string) {
    const text = editedText.trim();
    if (!name || !text) return;
    await addTemplate(name, text);
    await emit(EVENT_TEMPLATES_UPDATED);
    showTemplateSavedToast = true;
    setTimeout(() => { showTemplateSavedToast = false; }, 1800);
  }

  // Language selector functions for popup
  function togglePopupAzureLang(code: string) {
    const current = settings.languages;
    let newLangs: string[];
    if (current.includes(code)) {
      if (current.length > 1) {
        newLangs = current.filter((l) => l !== code);
      } else {
        return; // Keep at least one
      }
    } else {
      newLangs = [...current, code];
    }
    settings = { ...settings, languages: newLangs };
    persistLanguageChange();
  }

  function selectPopupSingleLang(code: string) {
    if (settings.speech_provider === PROVIDER_OS) {
      settings = { ...settings, os_language: code };
    } else if (settings.speech_provider === PROVIDER_WHISPER) {
      settings = { ...settings, whisper_language: code };
    }
    langDropdownOpen = false;
    persistLanguageChange();
  }

  async function persistLanguageChange() {
    try {
      await saveSettings(settings);
      await emit(EVENT_SETTINGS_UPDATED);
    } catch (e) {
      console.error("Failed to persist language change:", e);
    }
  }

  // Load audio devices on mount
  $effect(() => {
    enumerateAudioDevices().then(result => {
      audioDevices = result.devices;
      micWarning = result.error ?? "";
    });
  });

  async function selectMicrophone(deviceId: string) {
    settings = { ...settings, microphone_device_id: deviceId };
    micDropdownOpen = false;
    try {
      await saveSettings(settings);
      await emit(EVENT_SETTINGS_UPDATED);
    } catch (e) {
      console.error("Failed to persist microphone change:", e);
    }
  }

  // Listen to templates-updated from Settings
  $effect(() => {
    const listenPromise = listen(EVENT_TEMPLATES_UPDATED, async () => {
      if (templatesOpen) {
        templateEntries = await getTemplates();
      }
    });
    return () => { listenPromise.then((fn) => fn()); };
  });

  // Listen to enhancer-templates-updated from Settings
  $effect(() => {
    const listenPromise = listen(EVENT_ENHANCER_TEMPLATES_UPDATED, async () => {
      enhancerTemplates = await getEnhancerTemplates();
    });
    return () => { listenPromise.then((fn) => fn()); };
  });

  // Listen for MCP voice requests from the Rust backend
  $effect(() => {
    const listenPromise = listen<McpVoiceRequest>(EVENT_MCP_VOICE_REQUEST, (event) => {
      mcpRequest = event.payload;
      // Always start MCP requests with an empty editor so the ask is clear.
      finalSegments = [];
      interimText = "";
      editedText = "";
      userHasEdited = false;
      lastSyncedSegmentCount = 0;
      cursorPosition = 0;

      focusTextareaAtEnd();
    });
    return () => { listenPromise.then((fn) => fn()); };
  });

  // Auto-connect to Copilot when enabled
  $effect(() => {
    const enabled = settings.copilot_enabled;
    if (enabled && copilotStatus === 'disconnected') {
      copilotStatus = 'connecting';
      copilotError = '';
      (async () => {
        try {
          await copilotInit();
          const auth = await copilotAuthStatus();
          copilotAuth = auth;
          if (auth?.authenticated) {
            copilotModels = await copilotListModels();
            copilotStatus = 'connected';
            // Restore saved model selection
            if (settings.copilot_selected_model && copilotModels.some(m => m.id === settings.copilot_selected_model)) {
              copilotSelectedModel = settings.copilot_selected_model;
            }
          } else {
            copilotStatus = 'error';
            copilotError = 'Not signed in to GitHub Copilot';
          }
        } catch (e: any) {
          copilotStatus = 'error';
          copilotError = String(e);
        }
        // Load enhancer templates regardless of connection status
        enhancerTemplates = await getEnhancerTemplates();
        // Restore saved enhancer selection (or use default from settings)
        const savedEnhancer = settings.copilot_selected_enhancer;
        if (savedEnhancer && enhancerTemplates.some(t => t.id === savedEnhancer)) {
          selectedEnhancerId = savedEnhancer;
        } else if (enhancerTemplates.length > 0) {
          selectedEnhancerId = enhancerTemplates[0].id;
        }
      })();
    } else if (!enabled && copilotStatus !== 'disconnected') {
      copilotStop().catch(e => console.error("Failed to stop Copilot:", e));
      copilotStatus = 'disconnected';
      copilotAuth = null;
      copilotModels = [];
      copilotError = '';
    }
  });

  // Persist selected model change
  async function handleModelChange(modelId: string) {
    copilotSelectedModel = modelId;
    settings = { ...settings, copilot_selected_model: modelId };
    // Blur select so it doesn't capture keyboard shortcuts
    (document.activeElement as HTMLElement)?.blur();
    try {
      await saveSettings(settings);
      await emit(EVENT_SETTINGS_UPDATED);
    } catch (e) {
      console.error("Failed to persist model selection:", e);
    }
  }

  // Persist selected enhancer change
  async function handleEnhancerChange(enhancerId: string) {
    selectedEnhancerId = enhancerId;
    settings = { ...settings, copilot_selected_enhancer: enhancerId };
    // Blur select so it doesn't capture keyboard shortcuts
    (document.activeElement as HTMLElement)?.blur();
    try {
      await saveSettings(settings);
      await emit(EVENT_SETTINGS_UPDATED);
    } catch (e) {
      console.error("Failed to persist enhancer selection:", e);
    }
  }

  // Undo last enhancement (multi-level)
  function undoEnhance() {
    if (enhanceUndoStack.length === 0) return;
    editedText = enhanceUndoStack[enhanceUndoStack.length - 1];
    enhanceUndoStack = enhanceUndoStack.slice(0, -1);
    userHasEdited = true;
    showEnhanceToast = false;
    if (enhanceToastTimer) { clearTimeout(enhanceToastTimer); enhanceToastTimer = null; }
  }

  // Execute prompt enhancement
  async function executeEnhance() {
    if (enhancing) return;
    enhancing = true;
    copilotError = '';
    try {
      // Stop mic first if recording
      if (status === 'listening') {
        await stopAndRecordUsage();
      }
      const text = editedText.trim();
      if (!text || !copilotSelectedModel || !selectedEnhancerId || copilotStatus !== 'connected') return;
      const template = enhancerTemplates.find(t => t.id === selectedEnhancerId);
      if (!template) return;
      const systemPrompt = ENHANCE_SYSTEM_PROMPT_WRAPPER + template.text;
      const result = await copilotEnhance(copilotSelectedModel, systemPrompt, text, settings.copilot_delete_sessions);
      if (!result || !result.trim()) {
        copilotError = 'Enhancement returned empty result';
        return;
      }
      // Push current text to undo stack before replacing
      enhanceUndoStack = [...enhanceUndoStack, editedText];
      editedText = result;
      userHasEdited = true;
      // Show enhancement toast
      showEnhanceToast = true;
      if (enhanceToastTimer) clearTimeout(enhanceToastTimer);
      enhanceToastTimer = setTimeout(() => { showEnhanceToast = false; enhanceToastTimer = null; }, 4000);
    } catch (e: any) {
      copilotError = String(e);
    } finally {
      enhancing = false;
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} onclick={() => { langDropdownOpen = false; micDropdownOpen = false; }} />

<div class="popup-container">
  <!-- Compact title bar -->
  <div class="titlebar" class:mac={isMac} data-tauri-drag-region>
    {#if isMac}
      <div class="mac-window-controls">
        <button class="mac-close" onclick={dismiss} aria-label="Close" title="Close (Esc)"></button>
      </div>
    {/if}
    <div class="titlebar-left" data-tauri-drag-region>
      <span class="title" data-tauri-drag-region>Developer Voice to Prompt</span>
      <button
        class="provider-toggle"
        onclick={() => {
          if (status !== "listening") {
            settings = { ...settings, speech_provider: cycleProvider(settings.speech_provider) };
          }
        }}
        disabled={status === "listening"}
        title={`Using ${providerLabel(settings.speech_provider)} — click to switch`}
      >
        {providerLabel(settings.speech_provider)}
      </button>
      {#if settings.speech_provider === PROVIDER_AZURE && settings.languages.length > 0}
        {#if status === "listening"}
          <span class="lang-indicator" title={languageDisplayLabels.join(', ')}>{languageDisplayLabels.join(' · ')}</span>
        {:else}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <button class="lang-indicator lang-selector-btn" onclick={(e) => { e.stopPropagation(); langDropdownOpen = !langDropdownOpen; langDropdownFilter = ''; }} title="Click to change languages">
            {languageDisplayLabels.join(' · ')} ▾
          </button>
        {/if}
      {:else if settings.speech_provider === PROVIDER_OS}
        {#if status === "listening"}
          <span class="lang-indicator" title={settings.os_language}>{osLanguageDisplayLabel()}</span>
        {:else}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <button class="lang-indicator lang-selector-btn" onclick={(e) => { e.stopPropagation(); langDropdownOpen = !langDropdownOpen; langDropdownFilter = ''; }} title="Click to change language">
            {osLanguageDisplayLabel()} ▾
          </button>
        {/if}
      {:else if settings.speech_provider === PROVIDER_WHISPER}
        {#if status === "listening"}
          <span class="lang-indicator" title={settings.whisper_language}>{whisperLanguageDisplayLabel()}</span>
        {:else}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <button class="lang-indicator lang-selector-btn" onclick={(e) => { e.stopPropagation(); langDropdownOpen = !langDropdownOpen; langDropdownFilter = ''; }} title="Click to change language">
            {whisperLanguageDisplayLabel()} ▾
          </button>
        {/if}
      {/if}
      {#if langDropdownOpen && status !== "listening"}
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
              {#if settings.speech_provider === PROVIDER_AZURE}
                <label class="lang-dropdown-item">
                  <input
                    type="checkbox"
                    checked={settings.languages.includes(lang.code)}
                    onchange={() => togglePopupAzureLang(lang.code)}
                  />
                  <span>{lang.label}</span>
                  <span class="lang-dropdown-code">{lang.code}</span>
                </label>
              {:else}
                <button
                  class="lang-dropdown-item"
                  class:selected={settings.speech_provider === PROVIDER_OS ? settings.os_language === lang.code : settings.whisper_language === lang.code}
                  onclick={() => selectPopupSingleLang(lang.code)}
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
    <div class="titlebar-buttons">
      <!-- Microphone selector -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="mic-selector-wrapper" onclick={(e) => e.stopPropagation()}>
        <button
          class="mic-selector-btn"
          onclick={() => { micDropdownOpen = !micDropdownOpen; }}
          disabled={status === "listening" || enhancing}
          title={`Microphone: ${selectedMicLabel()}`}
        >
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>
          <span class="mic-selector-label">{selectedMicLabel()}</span>
          <span class="mic-selector-chevron">▾</span>
        </button>
        {#if micDropdownOpen && status !== "listening"}
          <div class="mic-dropdown">
            <button
              class="mic-dropdown-item"
              class:selected={!settings.microphone_device_id}
              onclick={() => selectMicrophone("")}
            >
              System Default
            </button>
            {#each audioDevices as device}
              <button
                class="mic-dropdown-item"
                class:selected={settings.microphone_device_id === device.deviceId}
                onclick={() => selectMicrophone(device.deviceId)}
              >
                {device.label}
              </button>
            {/each}
          </div>
        {/if}
      </div>

      <button
        class="history-toggle"
        onclick={toggleTemplatesPanel}
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
          class="history-toggle"
          onclick={toggleHistoryPanel}
          class:active={historyOpen}
          disabled={enhancing}
          aria-label="Toggle history"
          aria-pressed={historyOpen}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          History
          {#if historyCount > 0}
            <span class="history-badge">{historyCount}</span>
          {/if}
        </button>
      {/if}
      <button class="titlebar-btn" onclick={() => { helpOpen = !helpOpen; aboutOpen = false; }} aria-label="Keyboard shortcuts" title="Keyboard shortcuts">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
      </button>
      {#if settings.copilot_enabled && copilotStatus === 'connected' && copilotAuth?.login}
        <img class="copilot-titlebar-avatar" src="https://github.com/{copilotAuth.login}.png?size=40" alt={copilotAuth.login} title={`Signed in as ${copilotAuth.login}`} />
      {/if}
      <button class="titlebar-btn" onclick={() => invoke('show_settings')} aria-label="Settings" title="Settings">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      </button>
      <button class="titlebar-btn" onclick={() => { aboutOpen = !aboutOpen; helpOpen = false; }} aria-label="About" title="About">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
      </button>
      {#if !isMac}
        <button class="titlebar-btn close-btn" onclick={dismiss} aria-label="Close" title="Close (Esc)">✕</button>
      {/if}
    </div>
  </div>

  <!-- Help overlay (keyboard shortcuts) -->
  <HelpOverlay {settings} bind:open={helpOpen} />
  <AboutOverlay bind:open={aboutOpen} />

  <div class="content">
    <div class="main-content">
      <!-- No microphone warning banner -->
      {#if micWarning}
        <div class="mic-warning-bar">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          <span class="mic-warning-text">{micWarning}</span>
          <button class="mic-warning-retry" onclick={() => enumerateAudioDevices().then(r => { audioDevices = r.devices; micWarning = r.error ?? ''; })}>Retry</button>
        </div>
      {/if}

      <!-- Recording status bar -->
      {#if status === "listening"}
        <div class="recording-bar">
          <span class="rec-dot"></span>
          <span class="rec-label">Listening...</span>
          <div class="level-meter">
            <div class="level-bar" style="width: {Math.round(audioLevel * 100)}%"></div>
          </div>
          <span class="rec-elapsed">{formatElapsed(elapsedSeconds)}</span>
        </div>
      {/if}

      <!-- MCP voice-request banner -->
      {#if isMcpMode && mcpRequest}
        <div class="mcp-context-banner">
          <div class="mcp-banner-icon-shell" aria-hidden="true">
            <span class="mcp-banner-ping"></span>
            <svg class="mcp-banner-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
              <path d="M8 12h8"/><path d="M12 8v8"/>
            </svg>
          </div>
          <div class="mcp-banner-content">
            <div class="mcp-banner-topline">
              <span class="mcp-banner-label">Agent Request Active</span>
              <span class="mcp-banner-badge">Waiting for your voice input</span>
            </div>
            <span class="mcp-banner-reason">{mcpRequest.input_reason}</span>
            <span class="mcp-banner-hint">Speak, type, then submit the result back to the requesting agent.</span>
          </div>
        </div>
      {/if}

      <!-- Text area for live editing -->
      <div class="text-area">
        {#if showEmptyState}
          <!-- Guided empty state -->
          <div class="empty-state">
            <svg class="empty-state-icon" viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" opacity="0.3">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
            {#if micWarning}
              <span class="empty-state-text">{micWarning}</span>
            {:else if settings.speech_provider === PROVIDER_AZURE && !settings.azure_speech_key}
              <span class="empty-state-text">Configure your Azure Speech key in <button class="link-btn" onclick={() => invoke('show_settings')}>Settings</button> to get started</span>
            {:else if settings.speech_provider === PROVIDER_OS && !webSpeechAvailable}
              <span class="empty-state-text">Web Speech API is not available. Switch to Azure or Whisper in <button class="link-btn" onclick={() => invoke('show_settings')}>Settings</button></span>
            {:else if settings.speech_provider === PROVIDER_WHISPER && !settings.whisper_model}
              <span class="empty-state-text">Download a Whisper model in <button class="link-btn" onclick={() => invoke('show_settings')}>Settings</button> to get started</span>
            {:else if settings.speech_provider === PROVIDER_WHISPER && whisperModelMissing}
              <span class="empty-state-text">Selected Whisper model is not downloaded. Download it in <button class="link-btn" onclick={() => invoke('show_settings')}>Settings</button> to get started</span>
            {:else}
              <span class="empty-state-text">Click the mic or press <kbd>{formatShortcutLabel(settings.popup_voice_shortcut)}</kbd> to start</span>
            {/if}
            {#if settings.provider_switch_shortcut}
              <span class="empty-state-hint">Press <kbd>{formatShortcutLabel(settings.provider_switch_shortcut)}</kbd> to switch between Web, Azure, and Whisper</span>
            {:else}
              <span class="empty-state-hint">Configure a provider switch shortcut in <button class="link-btn" onclick={() => invoke('show_settings')}>Settings</button> to quickly switch providers</span>
            {/if}
          </div>
        {/if}

        <textarea
          bind:this={textareaEl}
          value={editedText}
          oninput={handleTextInput}
          onmouseup={handleCursorChange}
          onkeyup={handleCursorChange}
          onscroll={handleTextareaScroll}
          class:recording={status === "listening"}
          class:empty-idle={showEmptyState}
          disabled={enhancing}
          style="font-family: {popupFontFamily}"
        ></textarea>

        <!-- Enhancing overlay -->
        {#if enhancing}
          <div class="enhancing-overlay">
            <svg class="enhancing-spinner" viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
            <span class="enhancing-label">Enhancing prompt...</span>
          </div>
        {/if}

        <!-- Floating mic button anchored to textarea -->
        <div class="mic-float">
          {#if settings.speech_provider === PROVIDER_WHISPER && status === "listening"}
            <div
              class="decode-ring"
              class:faded={!decodeActive}
              style="--progress: {decodeProgress}"
            ></div>
          {/if}
          <MicButton {status} onToggle={toggleMic} disabled={enhancing || !!micWarning} />
          {#if settings.speech_provider === PROVIDER_WHISPER && status === "listening" && decodeLatencyMs > 0}
            <span
              class="latency-badge"
              class:fast={decodeLatencyMs < 300}
              class:medium={decodeLatencyMs >= 300 && decodeLatencyMs < 800}
              class:slow={decodeLatencyMs >= 800}
              class:faded={!decodeActive}
            >{decodeLatencyMs}ms</span>
          {/if}
        </div>
      </div>

      <!-- Error message with action -->
      {#if errorMessage}
        <div class="error-bar">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <span class="error-text">{errorMessage}</span>
          {#if errorMessage.includes("key") || errorMessage.includes("configured")}
            <button class="error-action" onclick={() => invoke('show_settings')}>Open Settings</button>
          {/if}
        </div>
      {/if}

      <!-- Silence auto-stop message -->
      {#if silenceMessage}
        <div class="silence-msg" class:fading={silenceMessageFading}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          {silenceMessage}
        </div>
      {/if}

      <!-- Action buttons -->
      <div class="actions">
        {#if editedText.trim() || status === "listening"}
          <button
            class="btn btn-primary"
            onclick={copyAndClose}
            disabled={enhancing || (!editedText.trim() && status !== "listening")}
          >
            {primaryButtonLabel}
          </button>
          {#if editedText.trim() && status !== "listening"}
            <button class="btn btn-secondary" onclick={copyToClipboard} disabled={enhancing} aria-label="Copy to clipboard" title="Copy to clipboard">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            </button>
            <button class="btn btn-secondary" onclick={clearText} disabled={enhancing} aria-label="Clear text" title="Clear text">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
            <button class="btn btn-secondary" onclick={triggerSaveTemplate} disabled={enhancing} aria-label="Save as template" title="Save as template">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
            </button>
          {/if}
        {/if}

        <!-- Copilot enhancer (inline, after action buttons) -->
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
            {#if enhanceUndoStack.length > 0}
              <button
                class="copilot-undo-btn"
                onclick={undoEnhance}
                title="Undo enhancement (Ctrl+Z)"
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
                <span class="copilot-enhance-label">Undo</span>
              </button>
            {/if}
            <button
              class="copilot-enhance-btn"
              onclick={executeEnhance}
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
      </div>

      <!-- Copied toast -->
      {#if showCopiedToast}
        <div class="copied-toast">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          Copied!
        </div>
      {/if}



      <!-- Template saved toast -->
      {#if showTemplateSavedToast}
        <div class="copied-toast">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          Template saved!
        </div>
      {/if}

      <!-- Undo clear toast -->
      {#if showUndoToast}
        <div class="undo-toast">
          Text cleared
          <button class="undo-btn" onclick={undoClear}>Undo</button>
        </div>
      {/if}

      <!-- Enhancement toast -->
      {#if showEnhanceToast}
        <div class="undo-toast enhance-toast">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          Prompt enhanced
          <button class="undo-btn" onclick={undoEnhance}>Undo</button>
        </div>
      {/if}

    </div>

    <!-- Templates side panel -->
    <TemplatesPanel bind:open={templatesOpen} entries={templateEntries} onSelect={selectTemplate}
      onSave={saveAsTemplate} hasText={editedText.trim().length > 0} bind:saveTriggered={templateSaveTriggered} />

    <!-- History side panel -->
    <HistoryPanel bind:open={historyOpen} entries={historyEntries} bind:search={historySearch}
      onInsert={insertHistoryEntry} onDelete={handleHistoryDelete} />
  </div>
</div>

<style>
  .popup-container {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: var(--bg-primary);
    color: var(--text-primary);
    border-radius: 12px;
    overflow: hidden;
    border: 1px solid var(--border);
  }

  /* ---- Titlebar ---- */
  .titlebar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    background: var(--bg-secondary);
    user-select: none;
    -webkit-user-select: none;
    cursor: grab;
  }

  /* macOS: reduce left padding so traffic light sits at the native position */
  .titlebar.mac {
    padding-left: 10px;
  }

  /* macOS traffic light window controls */
  .mac-window-controls {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-right: 10px;
    flex-shrink: 0;
  }

  .mac-close {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #FF5F57;
    border: 0.5px solid rgba(0, 0, 0, 0.18);
    cursor: pointer;
    padding: 0;
    flex-shrink: 0;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.1s;
  }

  .mac-close::after {
    content: '✕';
    font-size: 7px;
    font-weight: 900;
    line-height: 1;
    color: transparent;
    transition: color 0.1s;
  }

  .mac-window-controls:hover .mac-close::after {
    color: rgba(0, 0, 0, 0.55);
  }

  .mac-close:hover {
    background: #E04E4B;
  }

  .titlebar-left {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 0;
  }

  .title {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary);
    line-height: 1;
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

  .titlebar-buttons {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .titlebar-btn {
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

  .titlebar-btn:hover {
    background: var(--surface-hover);
    color: var(--accent);
  }

  .close-btn:hover {
    color: var(--error);
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

  .history-toggle {
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

  .history-toggle:hover {
    background: var(--surface-hover);
    color: var(--accent);
    border-color: var(--accent);
  }

  .history-toggle.active {
    background: var(--accent);
    color: var(--bg-primary);
    border-color: var(--accent);
  }

  .history-badge {
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

  .history-toggle.active .history-badge {
    background: var(--bg-primary);
    color: var(--accent);
  }

  /* ---- Content Layout ---- */
  .content {
    flex: 1;
    display: flex;
    flex-direction: row;
    padding: 6px 6px;
    gap: 8px;
    min-height: 0;
    position: relative;
  }

  .main-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
    position: relative;
  }

  /* ---- Recording Status Bar ---- */
  .recording-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 10px;
    border-radius: 6px;
    background: var(--recording-glow);
    border: 1px solid color-mix(in srgb, var(--recording) 20%, transparent);
    animation: fadeIn 0.15s ease-out;
  }

  .rec-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--recording);
    animation: recPulse 1.2s ease-in-out infinite;
    flex-shrink: 0;
  }

  @keyframes recPulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  .rec-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--recording);
  }

  .level-meter {
    flex: 1;
    height: 6px;
    background: color-mix(in srgb, var(--recording) 10%, transparent);
    border-radius: 3px;
    overflow: hidden;
    min-width: 40px;
  }

  .level-bar {
    height: 100%;
    background: var(--recording);
    border-radius: 3px;
    transition: width 0.08s ease-out;
    min-width: 2px;
  }

  .rec-elapsed {
    font-size: 11px;
    color: var(--text-muted);
    font-family: "SF Mono", "Cascadia Code", "Consolas", monospace;
    margin-left: auto;
  }

  /* ---- Text Area ---- */
  .text-area {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    position: relative;
    padding-right: 28px;
  }

  /* Enhancing overlay */
  .enhancing-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    background: color-mix(in srgb, var(--bg-primary) 85%, transparent);
    z-index: 5;
    border-radius: 8px;
    backdrop-filter: blur(2px);
  }
  .enhancing-spinner {
    color: var(--accent);
    animation: spin 1s linear infinite;
  }
  .enhancing-label {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-secondary);
  }

  /* Empty state CTA */
  .empty-state {
    position: absolute;
    inset: 24px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    pointer-events: none;
    z-index: 1;
  }

  .empty-state-icon {
    color: var(--text-muted);
  }

  .empty-state-text {
    font-size: 13px;
    color: var(--text-muted);
    text-align: center;
    pointer-events: none;
  }

  .empty-state :global(.link-btn) {
    pointer-events: auto;
  }

  .empty-state-text kbd {
    font-size: 11px;
    padding: 1px 5px;
    border-radius: 3px;
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text-primary);
    font-family: "SF Mono", "Cascadia Code", "Consolas", monospace;
    font-weight: 600;
  }

  .link-btn {
    background: none;
    border: none;
    color: var(--accent);
    cursor: pointer;
    font-size: inherit;
    text-decoration: underline;
    padding: 0;
  }

  .link-btn:hover {
    color: var(--accent-hover);
  }

  textarea {
    width: 100%;
    height: 100%;
    background: var(--input-bg);
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px;
    font-size: 14px;
    font-family: var(--popup-font, inherit);
    resize: none;
    outline: none;
    line-height: 1.5;
    transition: border-color 0.2s, box-shadow 0.2s;
  }

  textarea:focus {
    border-color: var(--accent);
  }

  textarea.recording {
    border-color: var(--recording);
    box-shadow: 0 0 0 2px var(--recording-glow), inset 0 0 0 1px color-mix(in srgb, var(--recording) 8%, transparent);
    animation: recordingGlow 2s ease-in-out infinite;
  }

  textarea.empty-idle {
    caret-color: var(--text-primary);
  }

  @keyframes recordingGlow {
    0%, 100% { box-shadow: 0 0 0 2px var(--recording-glow), inset 0 0 0 1px color-mix(in srgb, var(--recording) 8%, transparent); }
    50% { box-shadow: 0 0 0 4px var(--recording-glow), inset 0 0 0 1px color-mix(in srgb, var(--recording) 15%, transparent); }
  }

  textarea::placeholder {
    color: var(--text-muted);
  }

  /* ---- Error Bar ---- */
  .error-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-radius: 6px;
    background: var(--error-bg);
    border: 1px solid var(--error-border);
    color: var(--error);
    font-size: 12px;
    animation: fadeIn 0.15s ease-out;
  }

  .error-text {
    flex: 1;
  }

  .error-action {
    background: none;
    border: 1px solid var(--error-border);
    color: var(--error);
    cursor: pointer;
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 4px;
    white-space: nowrap;
    transition: background 0.1s;
  }

  .error-action:hover {
    background: var(--error-border);
  }

  /* ---- Mic Warning Banner ---- */
  .mic-warning-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-radius: 6px;
    background: var(--warning-bg);
    border: 1px solid rgba(249, 226, 175, 0.15);
    color: var(--warning);
    font-size: 12px;
    animation: fadeIn 0.15s ease-out;
  }

  .mic-warning-text {
    flex: 1;
  }

  .mic-warning-retry {
    background: none;
    border: 1px solid rgba(249, 226, 175, 0.25);
    color: var(--warning);
    cursor: pointer;
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 4px;
    white-space: nowrap;
    transition: background 0.1s;
  }

  .mic-warning-retry:hover {
    background: rgba(249, 226, 175, 0.1);
  }

  /* ---- Silence Message ---- */
  .silence-msg {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--warning);
    padding: 5px 10px;
    border-radius: 6px;
    background: var(--warning-bg);
    border: 1px solid rgba(249, 226, 175, 0.15);
    transition: opacity 0.5s;
  }

  .silence-msg.fading {
    opacity: 0;
  }

  /* ---- Actions ---- */
  .actions {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 16px;
  }

  .btn {
    padding: 6px 16px;
    border: none;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s;
  }

  .btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .btn-primary {
    background: var(--accent);
    color: var(--bg-primary);
  }

  .btn-primary:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .btn-secondary {
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text-secondary);
    padding: 6px 8px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .btn-secondary:hover {
    background: var(--surface-hover);
    color: var(--accent);
    border-color: var(--accent);
  }

  /* ---- Copied Toast ---- */
  .copied-toast {
    position: absolute;
    bottom: 72px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--success);
    color: var(--bg-primary);
    font-size: 12px;
    font-weight: 600;
    padding: 5px 14px;
    border-radius: 20px;
    display: flex;
    align-items: center;
    gap: 5px;
    z-index: 20;
    animation: toastIn 0.2s ease-out;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
  }

  @keyframes toastIn {
    from { opacity: 0; transform: translateX(-50%) translateY(8px); }
    to { opacity: 1; transform: translateX(-50%) translateY(0); }
  }

  .undo-toast {
    position: absolute;
    bottom: 72px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--surface);
    color: var(--text-primary);
    font-size: 12px;
    font-weight: 500;
    padding: 5px 10px 5px 14px;
    border-radius: 20px;
    display: flex;
    align-items: center;
    gap: 8px;
    z-index: 20;
    animation: toastIn 0.2s ease-out;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
    border: 1px solid var(--border);
  }

  .undo-btn {
    background: none;
    border: none;
    color: var(--accent);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 4px;
  }

  .undo-btn:hover {
    background: var(--lang-tag-bg);
    text-decoration: underline;
  }

  /* ---- Floating Mic ---- */
  .mic-float {
    position: absolute;
    right: 3px;
    bottom: -21px;
    z-index: 10;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .mic-float :global(.mic-button) {
    width: 56px;
    height: 56px;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.18);
    position: relative;
    z-index: 2;
  }

  .mic-float :global(.mic-button svg) {
    width: 26px;
    height: 26px;
  }

  /* ---- Decode Ring ---- */
  .decode-ring {
    position: absolute;
    top: -4px;
    left: 50%;
    transform: translateX(-50%);
    width: 64px;
    height: 64px;
    border-radius: 50%;
    z-index: 1;
    pointer-events: none;
    background: conic-gradient(
      var(--accent) calc(var(--progress) * 360deg),
      transparent calc(var(--progress) * 360deg)
    );
    -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 3px), #fff calc(100% - 3px));
    mask: radial-gradient(farthest-side, transparent calc(100% - 3px), #fff calc(100% - 3px));
    opacity: 0.85;
    transition: opacity 0.4s ease;
  }

  .decode-ring.faded {
    opacity: 0.15;
  }

  /* ---- Latency Badge ---- */
  .latency-badge {
    margin-top: 2px;
    font-size: 10px;
    font-family: "SF Mono", "Cascadia Code", "Consolas", monospace;
    padding: 1px 6px;
    border-radius: 8px;
    line-height: 1.4;
    white-space: nowrap;
    transition: opacity 0.4s ease, background 0.3s ease, color 0.3s ease;
    z-index: 2;
  }

  .latency-badge.fast {
    background: color-mix(in srgb, var(--green) 20%, transparent);
    color: var(--green);
  }

  .latency-badge.medium {
    background: color-mix(in srgb, var(--yellow) 20%, transparent);
    color: var(--yellow);
  }

  .latency-badge.slow {
    background: color-mix(in srgb, var(--peach) 20%, transparent);
    color: var(--peach);
  }

  .latency-badge.faded {
    opacity: 0.4;
  }

  /* Empty state hint for provider switch shortcut */
  .empty-state-hint {
    font-size: 11px;
    color: var(--text-muted);
    text-align: center;
    pointer-events: none;
    opacity: 0.7;
  }
  .empty-state-hint kbd {
    font-size: 10px;
    padding: 1px 4px;
    border-radius: 3px;
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text-primary);
    font-family: "SF Mono", "Cascadia Code", "Consolas", monospace;
    font-weight: 600;
  }

  /* Language selector dropdown */
  .lang-selector-btn {
    cursor: pointer;
    border: 1px solid var(--accent);
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }
  .lang-selector-btn:hover {
    background: color-mix(in srgb, var(--accent) 20%, transparent);
  }

  .titlebar-left {
    position: relative;
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

  /* ---- Copilot Inline (inside actions) ---- */
  .copilot-inline {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-right: 64px;
    flex-wrap: wrap;
  }

  .copilot-titlebar-avatar {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    flex-shrink: 0;
    margin: 0 -1px;
  }

  .copilot-select {
    padding: 3px 6px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text-primary);
    font-size: 11px;
    cursor: pointer;
    outline: none;
    field-sizing: content;
  }
  .copilot-select:focus { border-color: var(--accent); }
  .copilot-select option { background: var(--input-bg); color: var(--text-primary); }

  .copilot-enhance-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    background: color-mix(in srgb, var(--accent) 15%, transparent);
    border: 1px solid var(--accent);
    color: var(--accent);
    cursor: pointer;
    padding: 3px 10px;
    border-radius: 4px;
    transition: all 0.15s;
    white-space: nowrap;
    font-size: 11px;
    font-weight: 500;
  }
  .copilot-enhance-btn:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent) 30%, transparent);
  }
  .copilot-enhance-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .copilot-undo-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    background: color-mix(in srgb, var(--text-muted) 10%, transparent);
    border: 1px solid var(--border);
    color: var(--text-secondary);
    cursor: pointer;
    padding: 3px 10px;
    border-radius: 4px;
    transition: all 0.15s;
    white-space: nowrap;
    font-size: 11px;
    font-weight: 500;
  }
  .copilot-undo-btn:hover {
    background: color-mix(in srgb, var(--text-muted) 20%, transparent);
    color: var(--text-primary);
  }
  .copilot-enhance-label {
    line-height: 1;
  }
  .copilot-error {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--red);
    padding: 4px 8px;
    background: color-mix(in srgb, var(--red) 8%, transparent);
    border-radius: 4px;
    margin-right: 64px;
  }
  .copilot-error-dismiss {
    background: none;
    border: none;
    color: var(--red);
    cursor: pointer;
    padding: 0 2px;
    font-size: 12px;
    opacity: 0.7;
    margin-left: auto;
  }
  .copilot-error-dismiss:hover {
    opacity: 1;
  }
  .enhance-toast {
    bottom: 72px;
  }

  .spin {
    animation: spin 1s linear infinite;
  }
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
</style>
