import type { ExecResult } from "../types";

export type AgentType = "codex" | "aider";

export interface AgentParams {
  prompt: string;
  repoRoot: string;
  workingDirectory?: string;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  model: string;
  testCommand?: string;
}

export interface Agent {
  name: AgentType;
  install(version?: string): void;
  run(params: AgentParams): ExecResult;
}
