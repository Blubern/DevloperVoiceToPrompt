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

export { providerRegistry };
