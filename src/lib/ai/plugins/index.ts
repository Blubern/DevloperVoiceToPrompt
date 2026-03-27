// ---------------------------------------------------------------------------
// AI Plugin registration — import this module to populate the registry
// ---------------------------------------------------------------------------

import { aiProviderRegistry } from "../registry";
import copilotPlugin from "./copilot";
import openaiPlugin from "./openai";
import ollamaPlugin from "./ollama";

// Registration order determines UI tab order
aiProviderRegistry.register(copilotPlugin);
aiProviderRegistry.register(openaiPlugin);
aiProviderRegistry.register(ollamaPlugin);

export { aiProviderRegistry };
