import { Mastra } from "@mastra/core";
import { planningAgent } from "./agents/planning.js";

// Mastra instance configuration
export const mastra = new Mastra({
  agents: {
    planningAgent,
  },
});

export { planningAgent };
