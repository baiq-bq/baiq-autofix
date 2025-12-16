import * as core from "@actions/core";
import { spawnSync } from "child_process";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";

import type { ExecResult } from "../types";
import type { Agent, AgentParams } from "./types";
import { exec } from "../utils";

// Note: fs, os, path are still used by configureCodex()

export const DEFAULT_CODEX_MODEL = "gpt-5-codex";

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
  core.exportVariable("OPENAI_API_KEY", params.openaiApiKey);

  // Step 1: Configure codex to use API key authentication (file-based)
  configureCodex();

  // Run from working directory if specified, otherwise repo root
  const cwd = params.workingDirectory || params.repoRoot;

  // Build environment with API key for all commands (pass via env, not command string)
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    OPENAI_API_KEY: params.openaiApiKey!.trim(),
  };

  // Step 2: Non-interactive codex login with API key via stdin
  // Using printf to avoid adding a trailing newline
  core.info("Logging in to Codex with API key...");
  const loginResult = spawnSync("sh", ["-c", 'printf "%s" "$OPENAI_API_KEY" | codex login --with-api-key'], {
    cwd,
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (loginResult.status !== 0) {
    core.warning(`Codex login returned non-zero: ${loginResult.stderr}`);
  } else {
    core.info("Codex login successful.");
  }

  // Step 3: Run codex exec with the prompt
  // Pass --config preferred_auth_method="apikey" and use env for API key
  core.info("Running Codex...");
  core.info(`codex --config preferred_auth_method="apikey" exec --full-auto --model ${params.model} <prompt>`);

  const result = spawnSync(
    "codex",
    ["--config", 'preferred_auth_method="apikey"', "exec", "--full-auto", "--model", params.model, params.prompt],
    {
      cwd,
      encoding: "utf8",
      env,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 600_000, // 10 minute timeout
    }
  );

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
