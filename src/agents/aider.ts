import * as core from "@actions/core";
import { spawnSync } from "child_process";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";

import type { ExecResult } from "../types";
import type { Agent, AgentParams } from "./types";
import { exec } from "../utils";

export const DEFAULT_AIDER_MODEL = "gpt-4o";

export function installAider(version?: string): void {
  core.info(`Installing Aider${version ? ` (version: ${version})` : ""}...`);
  const pkg = version ? `aider-chat==${version}` : "aider-chat";
  const res = exec(`pip install ${pkg}`, { silent: true });
  if (res.exitCode !== 0) {
    throw new Error(`Failed to install Aider: ${res.stderr || res.stdout}`);
  }
  core.info("Aider installed successfully.");
}

export function runAider(params: AgentParams): ExecResult {
  // Validate at least one API key is present
  const hasOpenAI = params.openaiApiKey && params.openaiApiKey.trim() !== "";
  const hasAnthropic = params.anthropicApiKey && params.anthropicApiKey.trim() !== "";

  if (!hasOpenAI && !hasAnthropic) {
    return {
      stdout: "",
      stderr: "Error: Neither OPENAI_API_KEY nor ANTHROPIC_API_KEY is provided",
      exitCode: 1,
    };
  }

  // Write prompt to a temp file to avoid shell escaping issues
  const promptFile = path.join(os.tmpdir(), `aider-prompt-${Date.now()}.txt`);
  fs.writeFileSync(promptFile, params.prompt, "utf8");

  // Build aider command arguments
  // --yes-always: auto-accept all confirmations including adding files (non-interactive)
  // --no-auto-commits: don't auto-commit changes (we handle git ourselves)
  // --subtree-only: limit to working directory if specified
  // --model: specify the model
  // --message-file: read prompt from file
  const args = ["--yes-always", "--no-auto-commits"];

  // If working directory is a subdirectory, use --subtree-only to limit scope
  if (params.workingDirectory && params.workingDirectory !== params.repoRoot) {
    args.push("--subtree-only");
  }

  args.push("--model", params.model, "--message-file", promptFile);

  core.info("Running Aider...");
  core.info(`aider ${args.slice(0, -2).join(" ")} --message-file <prompt>`);

  // Build environment with API keys
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (hasOpenAI) {
    env.OPENAI_API_KEY = params.openaiApiKey;
  }
  if (hasAnthropic) {
    env.ANTHROPIC_API_KEY = params.anthropicApiKey;
  }

  // Run from working directory if specified, otherwise repo root
  const cwd = params.workingDirectory || params.repoRoot;

  const result = spawnSync("aider", args, {
    cwd,
    encoding: "utf8",
    env,
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

export const aiderAgent: Agent = {
  name: "aider",
  install: installAider,
  run: runAider,
};
