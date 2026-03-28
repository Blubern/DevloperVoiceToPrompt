// ---------------------------------------------------------------------------
// Windows Speech provider — Windows.Media.SpeechRecognition
// ---------------------------------------------------------------------------
//
// Uses the UWP SpeechRecognizer API for real-time speech-to-text on Windows.
// Continuous recognition session with dictation grammar provides both
// hypothesis (interim) and result (final) events.
//
// Threading: WinRT event handlers run on a thread pool. The SpeechEmitter
// is cloned into each handler. The SpeechRecognizer and session are stored
// as managed state and accessed under a Mutex.
// ---------------------------------------------------------------------------

use super::{NativeSpeechProvider, SpeechEmitter};
use std::sync::{Arc, Mutex};
use windows::{
    Foundation::TypedEventHandler,
    Globalization::Language,
    Media::SpeechRecognition::{
        SpeechContinuousRecognitionResultGeneratedEventArgs,
        SpeechContinuousRecognitionSession, SpeechRecognitionResultStatus, SpeechRecognizer,
        SpeechRecognitionTopicConstraint, SpeechRecognitionScenario,
    },
};

// ---------------------------------------------------------------------------
// Inner state
// ---------------------------------------------------------------------------

struct InnerState {
    recognizer: SpeechRecognizer,
    session: SpeechContinuousRecognitionSession,
}

// Safety: WinRT objects are apartment-agile by default and safe to send
// between threads.
unsafe impl Send for InnerState {}

// ---------------------------------------------------------------------------
// WindowsSpeechProvider
// ---------------------------------------------------------------------------

pub struct WindowsSpeechProvider {
    state: Arc<Mutex<Option<InnerState>>>,
}

impl WindowsSpeechProvider {
    pub fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(None)),
        }
    }
}

impl NativeSpeechProvider for WindowsSpeechProvider {
    fn id(&self) -> &str {
        "windows"
    }

    fn start(
        &mut self,
        config: serde_json::Value,
        emitter: SpeechEmitter,
    ) -> Result<(), String> {
        // Stop any existing session first
        self.stop().ok();

        let language_tag = config
            .get("language")
            .and_then(|v| v.as_str())
            .unwrap_or("en-US");

        // Create recognizer with language
        let language = Language::CreateLanguage(&language_tag.into())
            .map_err(|e| format!("Failed to create language '{language_tag}': {e}"))?;
        let recognizer = SpeechRecognizer::CreateWithLanguage(&language)
            .map_err(|e| format!("Failed to create SpeechRecognizer: {e}"))?;

        // Add dictation constraint for free-form speech
        let constraint =
            SpeechRecognitionTopicConstraint::Create(SpeechRecognitionScenario::Dictation, &"dictation".into())
                .map_err(|e| format!("Failed to create dictation constraint: {e}"))?;
        recognizer
            .Constraints()
            .map_err(|e| format!("Failed to get constraints: {e}"))?
            .Append(&constraint)
            .map_err(|e| format!("Failed to add constraint: {e}"))?;

        // Compile constraints (synchronous via GetResults)
        let compile_result = recognizer
            .CompileConstraintsAsync()
            .map_err(|e| format!("Failed to start constraint compilation: {e}"))?
            .get()
            .map_err(|e| format!("Constraint compilation failed: {e}"))?;

        if compile_result.Status().map_err(|e| e.to_string())?
            != SpeechRecognitionResultStatus::Success
        {
            return Err("Failed to compile speech recognition constraints.".into());
        }

        // Get continuous recognition session
        let session = recognizer
            .ContinuousRecognitionSession()
            .map_err(|e| format!("Failed to get continuous session: {e}"))?;

        // Subscribe to ResultGenerated (final results)
        let emitter_result = emitter.clone();
        session
            .ResultGenerated(&TypedEventHandler::new(
                move |_session: &Option<SpeechContinuousRecognitionSession>,
                      args: &Option<SpeechContinuousRecognitionResultGeneratedEventArgs>| {
                    if let Some(args) = args {
                        if let Ok(result) = args.Result() {
                            if let Ok(text) = result.Text() {
                                let text_str = text.to_string_lossy();
                                if !text_str.is_empty() {
                                    emitter_result.final_text(&text_str);
                                }
                            }
                        }
                    }
                    Ok(())
                },
            ))
            .map_err(|e| format!("Failed to register ResultGenerated handler: {e}"))?;

        // Subscribe to HypothesisGenerated (interim results)
        let emitter_hypothesis = emitter.clone();
        recognizer
            .HypothesisGenerated(&TypedEventHandler::new(
                move |_recognizer: &Option<SpeechRecognizer>,
                      args: &Option<
                    windows::Media::SpeechRecognition::SpeechRecognitionHypothesisGeneratedEventArgs,
                >| {
                    if let Some(args) = args {
                        if let Ok(hypothesis) = args.Hypothesis() {
                            if let Ok(text) = hypothesis.Text() {
                                let text_str = text.to_string_lossy();
                                if !text_str.is_empty() {
                                    emitter_hypothesis.interim(&text_str);
                                }
                            }
                        }
                    }
                    Ok(())
                },
            ))
            .map_err(|e| format!("Failed to register HypothesisGenerated handler: {e}"))?;

        // Subscribe to Completed for error handling
        let emitter_completed = emitter.clone();
        let state_for_complete = Arc::clone(&self.state);
        session
            .Completed(&TypedEventHandler::new(
                move |_session: &Option<SpeechContinuousRecognitionSession>,
                      args: &Option<
                    windows::Media::SpeechRecognition::SpeechContinuousRecognitionCompletedEventArgs,
                >| {
                    if let Some(args) = args {
                        if let Ok(status) = args.Status() {
                            if status != SpeechRecognitionResultStatus::Success {
                                let msg = match status {
                                    SpeechRecognitionResultStatus::MicrophoneUnavailable => {
                                        "Microphone is unavailable. Check your audio settings."
                                    }
                                    SpeechRecognitionResultStatus::NetworkFailure => {
                                        "Network failure during speech recognition."
                                    }
                                    _ => "Speech recognition session ended unexpectedly.",
                                };
                                emitter_completed.error(msg);
                            }
                        }
                    }
                    // Clean up state
                    if let Ok(mut guard) = state_for_complete.lock() {
                        *guard = None;
                    }
                    emitter_completed.status("idle");
                    Ok(())
                },
            ))
            .map_err(|e| format!("Failed to register Completed handler: {e}"))?;

        // Start continuous recognition
        session
            .StartAsync()
            .map_err(|e| format!("Failed to start recognition: {e}"))?
            .get()
            .map_err(|e| format!("Recognition start failed: {e}"))?;

        // Store state
        {
            let mut guard = self.state.lock().map_err(|e| e.to_string())?;
            *guard = Some(InnerState {
                recognizer,
                session,
            });
        }

        emitter.status("listening");
        Ok(())
    }

    fn stop(&mut self) -> Result<(), String> {
        let mut guard = self.state.lock().map_err(|e| e.to_string())?;
        if let Some(inner) = guard.take() {
            // Stop the continuous recognition session
            inner
                .session
                .StopAsync()
                .map_err(|e| format!("Failed to stop recognition: {e}"))?
                .get()
                .map_err(|e| format!("Stop recognition failed: {e}"))?;

            // Close the recognizer to release resources
            let closable: windows::Foundation::IClosable = windows::core::Interface::cast(&inner.recognizer)
                .map_err(|e| format!("Failed to cast recognizer: {e}"))?;
            closable
                .Close()
                .map_err(|e| format!("Failed to close recognizer: {e}"))?;
        }
        Ok(())
    }

    fn is_available(&self) -> bool {
        // Try to create a SpeechRecognizer — if it succeeds, the API is available
        SpeechRecognizer::Create().is_ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_id() {
        let provider = WindowsSpeechProvider::new();
        assert_eq!(provider.id(), "windows");
    }
}
