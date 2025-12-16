export type { Agent, AgentParams, AgentType } from "./types";
export { aiderAgent, installAider, runAider, DEFAULT_AIDER_MODEL } from "./aider";
export { codexAgent, installCodex, runCodex, DEFAULT_CODEX_MODEL } from "./codex";

import type { Agent, AgentType } from "./types";
import { aiderAgent } from "./aider";
import { codexAgent } from "./codex";

export function getAgent(type: AgentType): Agent {
  switch (type) {
    case "codex":
      return codexAgent;
    case "aider":
      return aiderAgent;
    default:
      throw new Error(`Unknown agent type: ${type}`);
  }
}

export function isValidAgentType(value: string): value is AgentType {
  return value === "codex" || value === "aider";
}
