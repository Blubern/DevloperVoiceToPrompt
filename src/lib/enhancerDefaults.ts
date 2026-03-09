// ---------------------------------------------------------------------------
// Default enhancer template prompt texts
// ---------------------------------------------------------------------------

export const DEVELOPER_PROMPT_OPTIMIZER_NAME = "Developer Prompt Optimizer";

export const LEGACY_DEVELOPER_PROMPT_OPTIMIZER_TEXT = `Take the raw dictated text and transform it into a clear, well-structured developer prompt. Fix grammar, remove filler words, and organize the intent into actionable instructions. Preserve all technical terms, code references, and specific requirements. Use concise professional language suitable for AI coding assistants. Leave the Language like it is no translations.`;

export const DEFAULT_DEVELOPER_PROMPT_OPTIMIZER_TEXT = `Take the raw dictated transcript and rewrite it into a clear, structured developer prompt.

Strict constraints:
- Do NOT add, infer, or expand any information.
- Only correct and reorganize what already exists in the transcript.
- If something is unclear, keep it as written instead of guessing.
- Preserve all technical terms, code references, and explicit requirements.
- Keep the original language. Do not translate.

Editing rules:
- Fix grammar and punctuation.
- Correct obvious voice-to-text transcription errors.
- Improve sentence clarity without changing the meaning.
- Remove only clear speech fillers (e.g., "um", "uh") and false starts.
- Do not remove content that could contain actual intent or requirements.

Organization rules:
- Cluster related ideas together.
- Convert scattered thoughts into coherent statements.
- Group related functionality into features if applicable.
- If steps are mentioned, present them as ordered steps under the relevant feature.
- If a bug or issue is described, structure it clearly (e.g., problem description, context, expected vs. actual behavior if present).

Output format (adaptive):
Choose the structure that best fits the transcript content. Do not force sections that are not present.

Possible structures include:
- Feature description
- Bug report
- Implementation task
- General developer note

Use headings when helpful, for example:

# Feature
Description

Steps (if mentioned)
1.
2.

# Bug
Problem
Context
Expected behavior
Actual behavior

Only include sections when the information exists in the transcript.

Goal:
Produce a concise, well-structured developer prompt suitable for AI coding agents that contains exactly the same information as the transcript, only corrected, clarified, and organized.`;

export const DICTATION_CLEANUP_NAME = "Dictation Cleanup";

export const LEGACY_DICTATION_CLEANUP_TEXT = `Clean up the raw dictated text without changing its meaning. Fix grammar, punctuation, and sentence structure. Remove filler words, false starts, and repetitions. Keep the original tone, intent, and all technical terms exactly as intended. Do not rephrase, summarize, or add anything new. Leave the Language like it is no translations.`;

export const DEFAULT_DICTATION_CLEANUP_TEXT = `Correct the transcript without changing its meaning or wording.

Only fix:
- grammar
- punctuation
- obvious transcription errors

Remove only clear speech fillers (e.g., "um", "uh") and false starts.

Do NOT:
- rephrase sentences
- change wording or tone
- summarize or shorten the text
- add any new information
- translate the text

Keep all technical terms exactly as they appear.
Preserve the original language.`;

export const DEFAULT_ENHANCER_TEMPLATES = [
  {
    name: DEVELOPER_PROMPT_OPTIMIZER_NAME,
    text: DEFAULT_DEVELOPER_PROMPT_OPTIMIZER_TEXT,
  },
  {
    name: DICTATION_CLEANUP_NAME,
    text: DEFAULT_DICTATION_CLEANUP_TEXT,
  },
];
