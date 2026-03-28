// ---------------------------------------------------------------------------
// Plugin registration — import this module to populate the registry
// ---------------------------------------------------------------------------

import { providerRegistry } from "../registry";
import osPlugin from "./os";
import azurePlugin from "./azure";
import whisperPlugin from "./whisper";

// Registration order determines UI tab order
providerRegistry.register(osPlugin);
providerRegistry.register(azurePlugin);
providerRegistry.register(whisperPlugin);

// Platform-specific native providers — registered conditionally
const isMac =
  typeof navigator !== "undefined" &&
  (navigator.platform?.toLowerCase().includes("mac") ||
    navigator.userAgent?.includes("Macintosh"));
const isWindows =
  typeof navigator !== "undefined" &&
  (navigator.platform?.toLowerCase().includes("win") ||
    navigator.userAgent?.includes("Windows"));

if (isMac) {
  import("./apple").then(({ default: applePlugin }) => {
    providerRegistry.register(applePlugin);
  });
}

if (isWindows) {
  import("./windows").then(({ default: windowsPlugin }) => {
    providerRegistry.register(windowsPlugin);
  });
}

export { providerRegistry };
