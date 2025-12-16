import * as core from "@actions/core";
import { spawnSync } from "child_process";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";

import type { ExecResult } from "../types";
import type { Agent, AgentParams } from "./types";
import { exec, shellEscape } from "../utils";

export const DEFAULT_CODEX_MODEL = "gpt-5.2";

function configureCodex(): void {
  // Create ~/.codex/config.toml with preferred_auth_method = "apikey"
  const codexConfigDir = path.join(os.homedir(), ".codex");
  const codexConfigFile = path.join(codexConfigDir, "config.toml");

  // Ensure the directory exists
  if (!fs.existsSync(codexConfigDir)) {
    fs.mkdirSync(codexConfigDir, { recursive: true });
  }

  // Write the config file
  const configContent = 'preferred_auth_method = "apikey"\n';
  fs.writeFileSync(codexConfigFile, configContent, "utf8");
  core.info(`Codex config written to ${codexConfigFile}`);
}

export function installCodex(version?: string): void {
  core.info(`Installing Codex CLI${version ? ` (version: ${version})` : ""}...`);
  const pkg = version ? `@openai/codex@${version}` : "@openai/codex";
  const res = exec(`npm install -g ${pkg}`, { silent: true });
  if (res.exitCode !== 0) {
    throw new Error(`Failed to install Codex CLI: ${res.stderr || res.stdout}`);
  }
  core.info("Codex CLI installed successfully.");
}

export function runCodex(params: AgentParams): ExecResult {
  // Codex requires OpenAI API key
  const hasOpenAI = params.openaiApiKey && params.openaiApiKey.trim() !== "";

  if (!hasOpenAI) {
    return {
      stdout: "",
      stderr: "Error: OPENAI_API_KEY is required for Codex agent",
      exitCode: 1,
    };
  }

  // Export OPENAI_API_KEY to the GitHub Actions environment (persists for the job)
  // This ensures the API key is available in the shell profile for codex
  core.exportVariable("OPENAI_API_KEY", params.openaiApiKey);

  // Step 1: Configure codex to use API key authentication
  configureCodex();

  // Step 2: Write prompt to a temp file to avoid shell escaping issues
  const promptFile = path.join(os.tmpdir(), `codex-prompt-${Date.now()}.txt`);
  fs.writeFileSync(promptFile, params.prompt, "utf8");

  // Run from working directory if specified, otherwise repo root
  const cwd = params.workingDirectory || params.repoRoot;

  // Step 3: Run codex with OPENAI_API_KEY set inline in the command
  const codexCmd =
    `OPENAI_API_KEY=${shellEscape(params.openaiApiKey!)} ` +
    `codex --config preferred_auth_method=apikey exec --full-auto --model ${shellEscape(params.model)} ` +
    `--message-file ${shellEscape(promptFile)}`;

  core.info("Running Codex...");
  core.info(`OPENAI_API_KEY=*** codex --approval-mode full-auto --model ${params.model} --message-file <prompt>`);

  const result = spawnSync("sh", ["-c", codexCmd], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 600_000, // 10 minute timeout
  });

  // Clean up prompt file
  try {
    fs.unlinkSync(promptFile);
  } catch {
    // Ignore cleanup errors
  }

  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 1,
  };
}

export const codexAgent: Agent = {
  name: "codex",
  install: installCodex,
  run: runCodex,
};
