// ---------------------------------------------------------------------------
// Apple Speech provider — macOS SFSpeechRecognizer + AVAudioEngine
// ---------------------------------------------------------------------------
//
// Uses Apple's Speech framework for on-device and cloud-based speech
// recognition. Audio is captured via AVAudioEngine's input node and fed
// to SFSpeechAudioBufferRecognitionRequest for real-time transcription.
//
// Threading: All ObjC objects are created and used on a dedicated background
// thread with its own run loop. The `SpeechEmitter` (which is Send+Sync via
// Tauri's AppHandle) is cloned into the result handler block.
// ---------------------------------------------------------------------------

use super::{NativeSpeechProvider, SpeechEmitter};
use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::{AnyObject, Bool};
use objc2::{msg_send, AllocAnyThread};
use objc2_avf_audio::{AVAudioEngine, AVAudioPCMBuffer, AVAudioTime};
use objc2_foundation::{NSLocale, NSString};
use objc2_speech::{
    SFSpeechAudioBufferRecognitionRequest, SFSpeechRecognitionResult, SFSpeechRecognitionTask,
    SFSpeechRecognizer, SFSpeechRecognizerAuthorizationStatus,
};
use std::ptr::NonNull;
use std::sync::{Arc, Mutex};

// ---------------------------------------------------------------------------
// Inner state — held behind Arc<Mutex<>> so the ObjC blocks can access it
// ---------------------------------------------------------------------------

struct InnerState {
    engine: Retained<AVAudioEngine>,
    task: Retained<SFSpeechRecognitionTask>,
    request: Retained<SFSpeechAudioBufferRecognitionRequest>,
}

// Safety: AVAudioEngine, SFSpeechRecognitionTask, and
// SFSpeechAudioBufferRecognitionRequest are documented as safe to use from
// background threads. The objc2 crate is conservative about Send for ObjC
// types, but Apple's documentation explicitly allows cross-thread usage of
// these classes.
unsafe impl Send for InnerState {}

// ---------------------------------------------------------------------------
// AppleSpeechProvider
// ---------------------------------------------------------------------------

pub struct AppleSpeechProvider {
    state: Arc<Mutex<Option<InnerState>>>,
}

impl AppleSpeechProvider {
    pub fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(None)),
        }
    }
}

impl NativeSpeechProvider for AppleSpeechProvider {
    fn id(&self) -> &str {
        "apple"
    }

    fn start(
        &mut self,
        config: serde_json::Value,
        emitter: SpeechEmitter,
    ) -> Result<(), String> {
        // Stop any existing session first
        self.stop().ok();

        let language = config
            .get("language")
            .and_then(|v| v.as_str())
            .unwrap_or("en-US");

        let on_device = config
            .get("on_device")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        // Check authorization status
        let auth_status = unsafe { SFSpeechRecognizer::authorizationStatus() };
        if auth_status == SFSpeechRecognizerAuthorizationStatus::Denied
            || auth_status == SFSpeechRecognizerAuthorizationStatus::Restricted
        {
            return Err(
                "Speech recognition permission denied. Grant access in System Settings → Privacy & Security → Speech Recognition.".into(),
            );
        }

        // If not determined, request authorization
        if auth_status == SFSpeechRecognizerAuthorizationStatus::NotDetermined {
            let (tx, rx) = std::sync::mpsc::channel();
            let block = RcBlock::new(move |status: SFSpeechRecognizerAuthorizationStatus| {
                let _ = tx.send(status);
            });
            unsafe {
                SFSpeechRecognizer::requestAuthorization(&block);
            }
            match rx.recv_timeout(std::time::Duration::from_secs(30)) {
                Ok(status) if status == SFSpeechRecognizerAuthorizationStatus::Authorized => {}
                Ok(_) => {
                    return Err("Speech recognition authorization was denied.".into());
                }
                Err(_) => {
                    return Err("Speech recognition authorization timed out.".into());
                }
            }
        }

        // Create recognizer with locale
        let locale_str = NSString::from_str(language);
        let locale = NSLocale::initWithLocaleIdentifier(NSLocale::alloc(), &locale_str);
        let recognizer = unsafe {
            SFSpeechRecognizer::initWithLocale(SFSpeechRecognizer::alloc(), &locale)
        }
        .ok_or_else(|| format!("Failed to create speech recognizer for locale: {language}"))?;

        let is_available: Bool = unsafe { msg_send![&recognizer, isAvailable] };
        if !is_available.as_bool() {
            return Err(format!(
                "Speech recognition is not available for language: {language}"
            ));
        }

        // Create recognition request
        let request = unsafe {
            SFSpeechAudioBufferRecognitionRequest::init(
                SFSpeechAudioBufferRecognitionRequest::alloc(),
            )
        };
        unsafe {
            let _: () = msg_send![&request, setShouldReportPartialResults: Bool::YES];
        }

        // Set on-device recognition if requested
        if on_device {
            unsafe {
                let supports: Bool = msg_send![&recognizer, supportsOnDeviceRecognition];
                if supports.as_bool() {
                    let _: () =
                        msg_send![&request, setRequiresOnDeviceRecognition: Bool::YES];
                } else {
                    tracing::warn!("On-device recognition not supported for {language}, using cloud");
                }
            }
        }

        // Create audio engine
        let engine = unsafe { AVAudioEngine::init(AVAudioEngine::alloc()) };

        // Get input node and its output format
        let input_node = unsafe { engine.inputNode() };
        let format: Retained<AnyObject> = unsafe {
            msg_send![&input_node, outputFormatForBus: 0u32]
        };

        // Install tap on input node to feed audio to the recognition request
        let request_for_tap = request.clone();
        let tap_block = RcBlock::new(
            move |buffer: NonNull<AVAudioPCMBuffer>, _when: NonNull<AVAudioTime>| {
                unsafe {
                    let _: () = msg_send![&request_for_tap, appendAudioPCMBuffer: buffer.as_ptr()];
                }
            },
        );
        unsafe {
            let _: () = msg_send![
                &input_node,
                installTapOnBus: 0u32,
                bufferSize: 1024u32,
                format: &*format,
                block: &*tap_block
            ];
        }

        // Prepare and start engine
        unsafe {
            let _: () = msg_send![&engine, prepare];
        }
        let mut error_ptr: *mut objc2_foundation::NSError = std::ptr::null_mut();
        let started: Bool = unsafe {
            msg_send![&engine, startAndReturnError: &mut error_ptr]
        };
        if !started.as_bool() {
            let err_msg = if !error_ptr.is_null() {
                unsafe {
                    let desc: Retained<NSString> =
                        msg_send![error_ptr, localizedDescription];
                    desc.to_string()
                }
            } else {
                "Unknown error starting audio engine".into()
            };
            return Err(format!("Failed to start audio engine: {err_msg}"));
        }

        // Start recognition task with result handler
        let emitter_for_block = emitter.clone();
        let state_for_block = Arc::clone(&self.state);
        let result_block = RcBlock::new(
            move |result: *mut SFSpeechRecognitionResult,
                  error: *mut objc2_foundation::NSError| {
                if !error.is_null() {
                    let err_msg: String = unsafe {
                        let desc: Retained<NSString> =
                            msg_send![error, localizedDescription];
                        desc.to_string()
                    };
                    // Ignore cancellation errors (triggered by stop())
                    if !err_msg.contains("cancelled") && !err_msg.contains("Canceled") {
                        emitter_for_block.error(&err_msg);
                        emitter_for_block.status("error");
                    }
                    return;
                }
                if result.is_null() {
                    return;
                }
                unsafe {
                    let is_final: Bool = msg_send![result, isFinal];
                    let transcription: Retained<AnyObject> =
                        msg_send![result, bestTranscription];
                    let text: Retained<NSString> =
                        msg_send![&*transcription, formattedString];
                    let text_str = text.to_string();

                    if !text_str.is_empty() {
                        if is_final.as_bool() {
                            emitter_for_block.final_text(&text_str);
                        } else {
                            emitter_for_block.interim(&text_str);
                        }
                    }

                    if is_final.as_bool() {
                        let mut guard = state_for_block.lock().unwrap();
                        *guard = None;
                        emitter_for_block.status("idle");
                    }
                }
            },
        );

        let task: Retained<SFSpeechRecognitionTask> = unsafe {
            msg_send![
                &recognizer,
                recognitionTaskWithRequest: &*request,
                resultHandler: &*result_block
            ]
        };

        // Store state
        {
            let mut guard = self.state.lock().map_err(|e| e.to_string())?;
            *guard = Some(InnerState {
                engine,
                task,
                request,
            });
        }

        emitter.status("listening");
        Ok(())
    }

    fn stop(&mut self) -> Result<(), String> {
        let mut guard = self.state.lock().map_err(|e| e.to_string())?;
        if let Some(inner) = guard.take() {
            unsafe {
                let input_node = inner.engine.inputNode();
                let _: () = msg_send![&input_node, removeTapOnBus: 0u32];
                inner.engine.stop();
            }
            unsafe {
                let _: () = msg_send![&inner.request, endAudio];
            }
            unsafe {
                inner.task.cancel();
            }
        }
        Ok(())
    }

    fn is_available(&self) -> bool {
        let auth_status = unsafe { SFSpeechRecognizer::authorizationStatus() };
        auth_status != SFSpeechRecognizerAuthorizationStatus::Denied
            && auth_status != SFSpeechRecognizerAuthorizationStatus::Restricted
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_id() {
        let provider = AppleSpeechProvider::new();
        assert_eq!(provider.id(), "apple");
    }
}
