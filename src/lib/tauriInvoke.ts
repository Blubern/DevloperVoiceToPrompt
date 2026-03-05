import { invoke } from "@tauri-apps/api/core";

/**
 * Typed wrapper around Tauri's invoke() with uniform error handling.
 */
export async function tauriInvoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (e) {
    const message =
      e instanceof Error ? e.message : typeof e === "string" ? e : String(e);
    throw new Error(`Tauri command "${command}" failed: ${message}`);
  }
}
