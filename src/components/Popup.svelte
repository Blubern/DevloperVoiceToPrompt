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
    revokeWorkletUrl,
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
  import CopilotEnhanceBar from "./popup/CopilotEnhanceBar.svelte";
  import SpeechTracePanel from "./popup/SpeechTracePanel.svelte";
  import DictationEditor from "./popup/DictationEditor.svelte";
  import { setTracingEnabled, clearTrace } from "../lib/speechTraceStore";
  import { traceEvent, setMaxEntries } from "../lib/speechTraceStore";
  import {
    PROVIDER_AZURE,
    PROVIDER_OS,
    PROVIDER_WHISPER,
    WHISPER_RTF_WARNING,
    WHISPER_RTF_CRITICAL,
    cycleProvider,
    providerLabel,
    EVENT_SETTINGS_UPDATED,
    EVENT_TEMPLATES_UPDATED,
    EVENT_MCP_VOICE_REQUEST,
    ENHANCE_SYSTEM_PROMPT_WRAPPER,
    FONT_FAMILIES,
    type RecordingStatus,
    type McpVoiceRequest,
  } from "../lib/constants";
  import { matchesShortcut, formatShortcutLabel } from "../lib/useKeyboardShortcuts";
  import { AudioLevelMeter } from "../lib/audioLevelMeter";
  import { copilotEnhance, type CopilotAuthStatus } from "../lib/copilotStore";
  import { InterimCommitManager } from "../lib/interimCommitManager";

  interface Props {
    settings: AppSettings;
  }

  let { settings }: Props = $props();

  const isMac = navigator.userAgent.toLowerCase().includes('macintosh') || navigator.platform.toLowerCase().includes('mac');

  let status = $state<RecordingStatus>("idle");
  let finalSegments = $state<string[]>([]);
  let errorMessage = $state("");
  let dictationEditor: DictationEditor | undefined = $state();
  let copilotEnhanceBar: CopilotEnhanceBar | undefined = $state();

  // Track user's edited text separately from speech output
  let editedText = $state("");
  let lastSyncedSegmentCount = $state(0);

  // True when the user clicked mid-text and dictation will insert there instead of appending
  let insertingAtCursor = $derived(status === "listening" && editedText.length > 0 && (dictationEditor?.isInsertingAtCursor() ?? false));

  // Context snippet for the insert-at-cursor tooltip
  let insertContextHint = $derived.by(() => {
    if (!insertingAtCursor) return "";
    const anchor = dictationEditor?.getAnchor() ?? editedText.length;
    const before = editedText.slice(Math.max(0, anchor - 20), anchor).trim();
    const after = editedText.slice(anchor, anchor + 20).trim();
    const b = before.length > 0 ? `…${before}` : "(start)";
    const a = after.length > 0 ? `${after}…` : "(end)";
    return `Inserting between: "${b}" ▸ "${a}"\nClick to resume appending at end.`;
  });

  // Usage tracking: record start time of current recognition session
  let sessionStartTime: number | null = null;
  let activeProvider: SpeechProvider | null = null;
  const interimManager = new InterimCommitManager();

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
  let undoSnapshot: { segments: string[]; text: string; syncCount: number } | null = $state(null);
  let showUndoToast = $state(false);
  let undoTimer: ReturnType<typeof setTimeout> | null = null;

  // Copilot state (connection managed by CopilotEnhanceBar, enhance orchestration kept here)
  let copilotAuth = $state<CopilotAuthStatus | null>(null);
  let copilotConnected = $state(false);
  let enhancing = $state(false);

  // Whisper model download check
  let whisperModelMissing = $state(false);

  // Enhancement undo stack (multi-level, resets on copy/close and clear)
  let enhanceUndoStack = $state<string[]>([]);
  let showEnhanceToast = $state(false);
  let enhanceToastTimer: ReturnType<typeof setTimeout> | null = null;

  // MCP mode: set when the popup was opened by an MCP tool call
  let mcpRequest = $state<McpVoiceRequest | null>(null);

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

  // Whisper performance monitoring
  let whisperRtf = $state(0);
  let whisperAvgRtf = $state(0);
  let whisperBackend = $state<string | undefined>(undefined);
  let performanceWarningDismissed = $state(false);
  let performanceState = $derived<'good' | 'warning' | 'critical'>(
    whisperAvgRtf >= WHISPER_RTF_CRITICAL ? 'critical' :
    whisperAvgRtf >= WHISPER_RTF_WARNING ? 'warning' : 'good'
  );

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
  let selectedMicLabel = $derived.by(() => {
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
  let osLanguageDisplayLabel = $derived.by(() => {
    const lang = SUPPORTED_LANGUAGES.find((l) => l.code === settings.os_language);
    return lang ? `${lang.label.split(" ")[0]} (${settings.os_language})` : settings.os_language;
  });

  let whisperLanguageDisplayLabel = $derived.by(() => {
    const lang = SUPPORTED_LANGUAGES.find((l) => l.code === settings.whisper_language);
    return lang ? `${lang.label.split(" ")[0]} (${settings.whisper_language})` : settings.whisper_language;
  });

  let popupFontFamily = $derived(FONT_FAMILIES[settings.popup_font] ?? FONT_FAMILIES.mono);

  // Sync speech tracing enabled state with settings
  $effect(() => {
    setTracingEnabled(settings.speech_tracing);
    setMaxEntries(settings.speech_trace_max_entries);
  });

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

  // Format elapsed time as m:ss
  function formatElapsed(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  // NOTE: Segment insertion $effect removed — text is now finalized in-place
  // by the onFinal callback via dictationEditor.finalizeInterim(). The
  // finalSegments array is still maintained for undo snapshot support.

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

    // Consolidate all focus-related logic in one listener to avoid stacking
    win.onFocusChanged(({ payload: focused }) => {
      if (focused) {
        // Refresh history when window regains focus
        if (historyOpen && settings.history_enabled) {
          getHistory().then(entries => {
            historyEntries = entries;
            historyCount = entries.length;
          }).catch(e => console.error("Failed to refresh history on focus:", e));
        }
        // Reset auto-start flag when popup regains focus
        if (settings.auto_start_recording && status === "idle" && !editedText) {
          autoStartDone = false;
        }
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
      let stale = false;
      getHistory().then(entries => { if (!stale) historyCount = entries.length; }).catch(e => console.error("Failed to load history count:", e));
      return () => { stale = true; };
    } else {
      historyCount = 0;
    }
  });

  // Auto-start recording when popup opens / regains focus
  let autoStartDone = $state(false);

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

  function handleEditorInput() {
    const oldLen = editedText.length;
    // Commit-on-edit: promote pending interim to final before the edit is applied
    if (dictationEditor?.hasInterim()) {
      interimManager.commitFromUI("user-edit");
    }
    traceEvent("event", "popup:userEdit", `User typed | old=${oldLen} chars → new=${editedText.length} chars`);
    // Typing counts as user activity — reset the silence timer so it
    // doesn't auto-stop recording while the user is actively editing.
    if (status === "listening") {
      resetSilenceTimer();
    }
  }

  function snapAnchorToEnd() {
    dictationEditor?.snapAnchorToEnd();
  }

  function focusTextareaAtEnd() {
    requestAnimationFrame(() => {
      dictationEditor?.focusAtEnd();
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
        traceEvent("warn", "popup:maxRecording", `Auto-stopped after ${settings.max_recording_seconds}s max recording time`);
        silenceMessage = `Auto-stopped after ${settings.max_recording_seconds}s max recording time`;
        silenceMessageFading = false;
        await stopAndRecordUsage(false, "max-recording-timeout");
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
        traceEvent("warn", "popup:silence", `Auto-paused after ${timeout}s of silence`);
        silenceMessage = `Auto-paused after ${timeout}s of silence`;
        silenceMessageFading = false;
        await stopAndRecordUsage(false, "silence-timeout");
        setTimeout(() => {
          silenceMessageFading = true;
          setTimeout(() => { silenceMessage = ""; silenceMessageFading = false; }, 500);
        }, 3500);
      }, timeout * 1000);
    }
  }

  async function stopAndRecordUsage(skipFlush = false, reason = "unspecified") {
    traceEvent("info", "popup:stop", `reason=${reason}, skipFlush=${skipFlush}, segments=${finalSegments.length}, interim=${dictationEditor?.hasInterim() ? "yes" : "no"}`);
    if (activeProvider) {
      await activeProvider.stop(skipFlush, reason);
      activeProvider.dispose();
      activeProvider = null;
    }
    // Commit-on-stop: promote any remaining interim after provider stop.
    if (dictationEditor?.hasInterim()) {
      interimManager.commitFromUI("stop");
    }
    interimManager.detach();
    status = "idle";
    clearSilenceTimer();
    clearMaxRecordingTimer();
    // Reset performance monitoring
    whisperRtf = 0;
    whisperAvgRtf = 0;
    performanceWarningDismissed = false;
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
    if (status === "listening" || status === "starting") {
      await stopAndRecordUsage(false, "user-toggle");
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
    // Promote any leftover interim text to committed so it isn't lost
    // when starting a new recording session.
    if (dictationEditor?.hasInterim()) {
      interimManager.commitFromUI("new-session");
    }
    interimManager.detach();
    lastSyncedSegmentCount = finalSegments.length;
    // Reset dictation anchor to end of text so new speech appends
    dictationEditor?.resetAnchorToEnd();
    userScrolledUp = false;

    const provider = createSpeechProvider(settings);

    // Attach the interim commit manager to coordinate provider ↔ editor
    interimManager.attach(
      {
        insertInterim: (text) => dictationEditor?.insertInterim(text),
        finalizeInterim: (text) => dictationEditor?.finalizeInterim(text),
        commitInterim: () => { dictationEditor?.commitInterim(); },
        hasInterim: () => dictationEditor?.hasInterim() ?? false,
      },
      (text) => {
        finalSegments = [...finalSegments, text];
        lastSyncedSegmentCount = finalSegments.length;
      },
    );

    const callbacks: SpeechCallbacks = {
      onInterim: (text) => {
        traceEvent("event", "popup:onInterim", `set interim (${text.length} chars), resetSilenceTimer`);
        interimManager.onProviderInterim(text);
        resetSilenceTimer();
      },
      onFinal: (text) => {
        if (text) {
          traceEvent("data", "popup:onFinal", `finalize segment #${finalSegments.length} (${text.length} chars): ${text.slice(0, 100)}${text.length > 100 ? "…" : ""}`);
          interimManager.onProviderFinal(text);
          resetSilenceTimer();
        }
      },
      onError: (err) => {
        traceEvent("warn", "popup:onError", err);
        errorMessage = err;
      },
      onStatusChange: (s) => {
        traceEvent("info", "popup:status", `${status} → ${s}`);
        status = s;
        if (s === "listening") {
          traceEvent("info", "popup:mic-start", `provider=${settings.speech_provider}, device=${settings.microphone_device_id || "default"}`);
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
      onPerformanceUpdate: (info) => {
        whisperRtf = info.rtf;
        whisperAvgRtf = info.avgRtf;
        if (info.backend) whisperBackend = info.backend;
      },
    };

    activeProvider = provider;
    status = "starting";
    provider.start(callbacks);

    // For non-Whisper providers, start a standalone audio level meter.
    // Whisper reports audio level via the onAudioLevel callback above.
    // TODO: Refactor OS/Azure providers to expose their MediaStream so it can be
    // passed here via existingStream, avoiding a second getUserMedia call.
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
        syncCount: lastSyncedSegmentCount,
      };
      showUndoToast = true;
      if (undoTimer) clearTimeout(undoTimer);
      undoTimer = setTimeout(() => {
        showUndoToast = false;
        undoSnapshot = null;
      }, 4000);
    }
    traceEvent("info", "popup:clear", `Cleared text | old=${editedText.length} chars, ${finalSegments.length} segments`);
    finalSegments = [];
    editedText = "";
    lastSyncedSegmentCount = 0;
    dictationEditor?.setCursorEnd();
    userScrolledUp = false;
    // Clear enhancement undo stack
    enhanceUndoStack = [];
    showEnhanceToast = false;
    if (enhanceToastTimer) { clearTimeout(enhanceToastTimer); enhanceToastTimer = null; }
  }

  function undoClear() {
    if (!undoSnapshot) return;
    traceEvent("info", "popup:undoClear", `Restored | old=0 chars → new=${undoSnapshot.text.length} chars, ${undoSnapshot.segments.length} segments`);
    finalSegments = undoSnapshot.segments;
    editedText = undoSnapshot.text;
    lastSyncedSegmentCount = undoSnapshot.syncCount;
    dictationEditor?.resetAnchorToEnd();
    undoSnapshot = null;
    showUndoToast = false;
    if (undoTimer) { clearTimeout(undoTimer); undoTimer = null; }
  }

  async function copyToClipboard() {
    const text = (dictationEditor?.getCommittedText() ?? editedText).trim();
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
    const text = (dictationEditor?.getCommittedText() ?? editedText).trim();
    // Clipboard and history operations must not prevent MCP submission or popup close
    try {
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
    } catch (e) {
      console.error("Failed to copy or save history:", e);
    }
    // Clear enhancement undo stack before clearText (which also clears it)
    enhanceUndoStack = [];
    showEnhanceToast = false;
    if (enhanceToastTimer) { clearTimeout(enhanceToastTimer); enhanceToastTimer = null; }
    if (status === "listening") {
      await stopAndRecordUsage(false, "copy-and-close");
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
      await stopAndRecordUsage(false, "dismiss");
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
        saveSettings(settings).then(() => emit(EVENT_SETTINGS_UPDATED)).catch(err => console.error("Failed to persist provider change:", err));
      }
    } else if (settings.prompt_enhancer_shortcut && matchesShortcut(e, settings.prompt_enhancer_shortcut)) {
      e.preventDefault();
      // Delegate to CopilotEnhanceBar via component ref
      copilotEnhanceBar?.triggerEnhance();
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

  async function handleHistoryDelete(id: string) {
    await deleteHistoryEntry(id);
    historyEntries = await getHistory();
    historyCount = historyEntries.length;
  }

  function insertHistoryEntry(text: string) {
    traceEvent("info", "popup:history", `Inserted from history | old=${editedText.length} chars → new=${text.length} chars`);
    editedText = text;
    dictationEditor?.resetAnchorToEnd();
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
    traceEvent("info", "popup:template", `Applied template | old=${editedText.length} chars → new=${t.text.length} chars`);
    editedText = t.text.replace(/\r\n/g, "\n");
    templatesOpen = false;
    dictationEditor?.setCursorEnd();
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
    let stale = false;
    enumerateAudioDevices().then(result => {
      if (stale) return;
      audioDevices = result.devices;
      micWarning = result.error ?? "";
    });
    return () => { stale = true; };
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
    let unlisten: (() => void) | null = null;
    listen(EVENT_TEMPLATES_UPDATED, async () => {
      if (templatesOpen) {
        templateEntries = await getTemplates();
      }
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  });

  // Global cleanup when the popup component is destroyed.
  // Clears all pending timers and releases shared resources.
  $effect(() => {
    return () => {
      revokeWorkletUrl();
      if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
      if (maxRecordingTimer) { clearTimeout(maxRecordingTimer); maxRecordingTimer = null; }
      if (autoStartTimer) { clearTimeout(autoStartTimer); autoStartTimer = null; }
      if (undoTimer) { clearTimeout(undoTimer); undoTimer = null; }
      if (enhanceToastTimer) { clearTimeout(enhanceToastTimer); enhanceToastTimer = null; }
      if (decodeFadeTimer) { clearTimeout(decodeFadeTimer); decodeFadeTimer = null; }
      if (resizeDebounce) { clearTimeout(resizeDebounce); resizeDebounce = null; }
      if (elapsedInterval) { clearInterval(elapsedInterval); elapsedInterval = null; }
      stopDecodeRaf();
      if (levelMeter) { levelMeter.stop(); levelMeter = null; }
      if (activeProvider) { activeProvider.dispose(); activeProvider = null; }
      // Cancel any pending MCP request so the caller isn't left hanging
      if (mcpRequest !== null) {
        mcpRequest = null;
        invoke("mcp_cancel").catch(() => {});
      }
    };
  });

  // Listen for MCP voice requests from the Rust backend
  $effect(() => {
    let unlisten: (() => void) | null = null;
    listen<McpVoiceRequest>(EVENT_MCP_VOICE_REQUEST, (event) => {
      mcpRequest = event.payload;
      // Start with context_input pre-filled, or empty editor if none provided.
      traceEvent("info", "popup:mcp", `MCP request | reason="${event.payload.input_reason}", context=${event.payload.context_input?.length ?? 0} chars, old=${editedText.length} chars`);
      finalSegments = [];
      editedText = event.payload.context_input ?? "";
      lastSyncedSegmentCount = 0;
      dictationEditor?.setCursorEnd();

      focusTextareaAtEnd();
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  });

  // Copilot status callback — used for titlebar avatar display
  function handleCopilotStatusUpdate(newStatus: string, auth: CopilotAuthStatus | null) {
    copilotConnected = newStatus === 'connected';
    copilotAuth = auth;
  }

  // Persist settings changes from CopilotEnhanceBar
  function handleCopilotSettingsChanged(updated: AppSettings) {
    settings = updated;
  }

  // Undo last enhancement (multi-level)
  function undoEnhance() {
    if (enhanceUndoStack.length === 0) return;
    const restored = enhanceUndoStack[enhanceUndoStack.length - 1];
    traceEvent("info", "popup:undoEnhance", `Undo enhancement | old=${editedText.length} chars → restored=${restored.length} chars`);
    editedText = restored;
    enhanceUndoStack = enhanceUndoStack.slice(0, -1);
    dictationEditor?.resetAnchorToEnd();
    showEnhanceToast = false;
    if (enhanceToastTimer) { clearTimeout(enhanceToastTimer); enhanceToastTimer = null; }
  }

  // Execute prompt enhancement — called by CopilotEnhanceBar with selected model and template
  async function executeEnhance(modelId?: string, templateText?: string) {
    if (enhancing) return;
    // When called from keyboard shortcut (no args), use copilotEnhanceBar reference
    if (!modelId || !templateText) return;
    enhancing = true;
    try {
      // Stop mic first if recording
      if (status === 'listening') {
        await stopAndRecordUsage(false, "enhance");
      }
      const text = editedText.trim();
      if (!text) return;
      const systemPrompt = ENHANCE_SYSTEM_PROMPT_WRAPPER + templateText;
      const result = await copilotEnhance(modelId, systemPrompt, text, settings.copilot_delete_sessions);
      if (!result || !result.trim()) {
        return;
      }
      // Push current text to undo stack before replacing
      enhanceUndoStack = [...enhanceUndoStack, editedText];
      traceEvent("data", "popup:enhance", `Copilot enhanced | old=${editedText.length} chars → new=${result.length} chars`);
      editedText = result;
      dictationEditor?.resetAnchorToEnd();
      // Show enhancement toast
      showEnhanceToast = true;
      if (enhanceToastTimer) clearTimeout(enhanceToastTimer);
      enhanceToastTimer = setTimeout(() => { showEnhanceToast = false; enhanceToastTimer = null; }, 4000);
    } catch (e: any) {
      console.error("Enhancement failed:", e);
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
        onclick={async () => {
          if (status !== "listening") {
            settings = { ...settings, speech_provider: cycleProvider(settings.speech_provider) };
            try {
              await saveSettings(settings);
              await emit(EVENT_SETTINGS_UPDATED);
            } catch (e) {
              console.error("Failed to persist provider change:", e);
            }
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
          <span class="lang-indicator" title={settings.os_language}>{osLanguageDisplayLabel}</span>
        {:else}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <button class="lang-indicator lang-selector-btn" onclick={(e) => { e.stopPropagation(); langDropdownOpen = !langDropdownOpen; langDropdownFilter = ''; }} title="Click to change language">
            {osLanguageDisplayLabel} ▾
          </button>
        {/if}
      {:else if settings.speech_provider === PROVIDER_WHISPER}
        {#if status === "listening"}
          <span class="lang-indicator" title={settings.whisper_language}>{whisperLanguageDisplayLabel}</span>
        {:else}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <button class="lang-indicator lang-selector-btn" onclick={(e) => { e.stopPropagation(); langDropdownOpen = !langDropdownOpen; langDropdownFilter = ''; }} title="Click to change language">
            {whisperLanguageDisplayLabel} ▾
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
      {#if settings.copilot_enabled && copilotConnected && copilotAuth?.login}
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
      {#if status === "starting"}
        <div class="recording-bar starting-bar">
          <svg class="starting-spinner" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
          <span class="rec-label">Starting microphone...</span>
        </div>
      {/if}
      {#if status === "listening"}
        <div class="recording-bar">
          <span class="rec-dot"></span>
          <span class="rec-label">Listening...</span>
          {#if insertingAtCursor}
            <button type="button" class="insert-at-cursor-badge" onclick={snapAnchorToEnd} title={insertContextHint}>
              ↳ Inserting at cursor <span class="badge-snap">· End ↵</span>
            </button>
          {/if}
          <div class="level-meter">
            <div class="level-bar" style="width: {Math.round(audioLevel * 100)}%"></div>
          </div>
          <span class="rec-elapsed">{formatElapsed(elapsedSeconds)}</span>
          {#if settings.speech_provider === PROVIDER_WHISPER}
            <span class="rec-bar-badges">
              {#if decodeLatencyMs > 0}
                <span
                  class="latency-badge"
                  class:fast={decodeLatencyMs < 300}
                  class:medium={decodeLatencyMs >= 300 && decodeLatencyMs < 800}
                  class:slow={decodeLatencyMs >= 800}
                  class:faded={!decodeActive}
                >{decodeLatencyMs}ms</span>
              {/if}
              {#if whisperAvgRtf > 0}
                <span
                  class="rtf-badge"
                  class:rtf-good={performanceState === 'good'}
                  class:rtf-warning={performanceState === 'warning'}
                  class:rtf-critical={performanceState === 'critical'}
                  class:faded={!decodeActive}
                  title="Real-Time Factor — lower is faster. >1.0 means hardware can't keep up."
                >{whisperAvgRtf.toFixed(1)}x</span>
              {/if}
              {#if whisperBackend}
                <span class="backend-badge" class:faded={!decodeActive}>{whisperBackend}</span>
              {/if}
            </span>
          {/if}
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

        <DictationEditor
          bind:this={dictationEditor}
          bind:text={editedText}
          fontFamily={popupFontFamily}
          disabled={enhancing}
          recording={status === "listening"}
          oninput={handleEditorInput}
          oncommit={() => interimManager.commitFromUI("cursor-move")}
        />

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
        </div>
      </div>

      <!-- Performance warning banner -->
      {#if settings.speech_provider === PROVIDER_WHISPER && status === "listening" && performanceState === 'critical' && !performanceWarningDismissed}
        <div class="perf-warning-bar">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          <span class="perf-warning-text">Model too large for your hardware — consider switching to a smaller model in Settings.</span>
          <button class="perf-warning-dismiss" onclick={() => performanceWarningDismissed = true}>Dismiss</button>
        </div>
      {/if}

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

      <!-- Speech trace panel (shown when speech_tracing is enabled) -->
      {#if settings.speech_tracing}
        <SpeechTracePanel />
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

        <!-- Copilot enhancer (delegated to sub-component) -->
        <CopilotEnhanceBar
          bind:this={copilotEnhanceBar}
          {settings}
          {status}
          {editedText}
          {enhancing}
          enhanceUndoStackSize={enhanceUndoStack.length}
          onEnhance={executeEnhance}
          onUndo={undoEnhance}
          onSettingsChanged={handleCopilotSettingsChanged}
          onStatusUpdate={handleCopilotStatusUpdate}
        />
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

  .recording-bar.starting-bar {
    background: color-mix(in srgb, var(--accent) 8%, transparent);
    border-color: color-mix(in srgb, var(--accent) 20%, transparent);
  }

  .starting-spinner {
    flex-shrink: 0;
    color: var(--accent);
    animation: spin 0.8s linear infinite;
  }

  .starting-bar .rec-label {
    color: var(--accent);
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
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

  .insert-at-cursor-badge {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 11px;
    font-weight: 500;
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent) 25%, transparent);
    border-radius: 4px;
    padding: 1px 7px;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.15s, border-color 0.15s;
  }
  .insert-at-cursor-badge:hover {
    background: color-mix(in srgb, var(--accent) 22%, transparent);
    border-color: var(--accent);
  }
  .badge-snap { opacity: 0.65; font-size: 10px; }

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

  /* ---- Recording bar badges container ---- */
  .rec-bar-badges {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-left: auto;
    flex-shrink: 0;
  }

  /* ---- Latency Badge ---- */
  .latency-badge {
    font-size: 10px;
    font-family: "SF Mono", "Cascadia Code", "Consolas", monospace;
    padding: 1px 6px;
    border-radius: 8px;
    line-height: 1.4;
    white-space: nowrap;
    transition: opacity 0.4s ease, background 0.3s ease, color 0.3s ease;
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

  /* RTF (Real-Time Factor) badge */
  .rtf-badge {
    font-size: 10px;
    font-family: "SF Mono", "Cascadia Code", "Consolas", monospace;
    padding: 1px 6px;
    border-radius: 8px;
    line-height: 1.4;
    white-space: nowrap;
    transition: opacity 0.4s ease, background 0.3s ease, color 0.3s ease;
  }
  .rtf-badge.rtf-good {
    background: color-mix(in srgb, var(--green) 20%, transparent);
    color: var(--green);
  }
  .rtf-badge.rtf-warning {
    background: color-mix(in srgb, var(--yellow) 20%, transparent);
    color: var(--yellow);
  }
  .rtf-badge.rtf-critical {
    background: color-mix(in srgb, var(--red) 20%, transparent);
    color: var(--red);
  }
  .rtf-badge.faded {
    opacity: 0.4;
  }

  /* Backend badge (CPU / CUDA / Metal) */
  .backend-badge {
    font-size: 9px;
    font-family: "SF Mono", "Cascadia Code", "Consolas", monospace;
    padding: 1px 5px;
    border-radius: 6px;
    line-height: 1.4;
    white-space: nowrap;
    background: color-mix(in srgb, var(--accent) 15%, transparent);
    color: var(--accent);
    transition: opacity 0.4s ease;
  }
  .backend-badge.faded {
    opacity: 0.4;
  }

  /* Performance warning banner */
  .perf-warning-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    border-radius: 6px;
    background: color-mix(in srgb, var(--red) 8%, transparent);
    border: 1px solid color-mix(in srgb, var(--red) 25%, transparent);
    color: var(--red);
    font-size: 11px;
    animation: fadeIn 0.15s ease-out;
  }
  .perf-warning-bar svg {
    flex-shrink: 0;
    color: var(--red);
  }
  .perf-warning-text {
    flex: 1;
  }
  .perf-warning-dismiss {
    flex-shrink: 0;
    font-size: 10px;
    padding: 2px 8px;
    border-radius: 4px;
    border: 1px solid color-mix(in srgb, var(--red) 30%, transparent);
    background: transparent;
    color: var(--red);
    cursor: pointer;
  }
  .perf-warning-dismiss:hover {
    background: color-mix(in srgb, var(--red) 12%, transparent);
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

  .copilot-titlebar-avatar {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    flex-shrink: 0;
    margin: 0 -1px;
  }

  .enhance-toast {
    bottom: 72px;
  }
</style>
