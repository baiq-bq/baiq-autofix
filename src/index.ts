import * as core from "@actions/core";
import * as github from "@actions/github";
import { execSync, spawnSync } from "child_process";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";

import { extractIssueFormFieldValue, parseGitHubIssueRef, truncate } from "./lib";

type ExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

function shellEscape(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

function exec(cmd: string, opts?: { silent?: boolean; env?: NodeJS.ProcessEnv; cwd?: string }): ExecResult {
  try {
    const stdout = execSync(cmd, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: opts?.env ?? process.env,
      cwd: opts?.cwd,
    });
    if (!opts?.silent) core.info(cmd);
    return { stdout, stderr: "", exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: Buffer; stderr?: Buffer; message?: string; status?: number };
    const stdout = e?.stdout?.toString?.() ?? "";
    const stderr = e?.stderr?.toString?.() ?? e?.message ?? "";
    if (!opts?.silent) core.info(cmd);
    return { stdout, stderr, exitCode: e?.status ?? 1 };
  }
}

function installAider(version: string): void {
  core.info(`Installing Aider${version ? ` (version: ${version})` : ""}...`);
  const pkg = version ? `aider-chat==${version}` : "aider-chat";
  const res = exec(`pip install ${pkg}`, { silent: true });
  if (res.exitCode !== 0) {
    throw new Error(`Failed to install Aider: ${res.stderr || res.stdout}`);
  }
  core.info("Aider installed successfully.");
}

function runAider(params: {
  prompt: string;
  repoRoot: string;
  workingDirectory?: string;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  model: string;
}): ExecResult {
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

function buildAiderPrompt(params: { issueTitle: string; issueBody: string; testFailureOutput?: string }): string {
  let prompt =
    "You are fixing a bug in this codebase based on a GitHub bug report issue.\n\n" +
    "The bug report structure is:\n" +
    "- USER STORY: describes the requirement/feature being tested\n" +
    "- TEST CASE: describes preconditions, step-by-step actions, and expected result\n" +
    "- BUG DESCRIPTION: explains expected vs actual behavior (the bug)\n\n" +
    `ISSUE TITLE: ${params.issueTitle}\n\n` +
    `ISSUE BODY:\n${params.issueBody}\n\n`;

  if (params.testFailureOutput) {
    prompt += "TEST FAILURE OUTPUT (from running the specific test before fix):\n" + `${params.testFailureOutput}\n\n`;
  }

  prompt +=
    "YOUR TASK:\n" +
    "1. Analyze the bug report and test failure output\n" +
    "2. Find the root cause of the bug in the codebase\n" +
    "3. Make the minimal fix needed so the actual behavior matches the expected behavior\n" +
    "4. Do NOT modify lockfiles (package-lock.json, pnpm-lock.yaml, yarn.lock) or .github/workflows/*\n" +
    "5. Do NOT add unnecessary changes - keep the fix focused and minimal";

  return prompt;
}

async function run(): Promise<void> {
  const ghToken = core.getInput("github-token", { required: true });
  const openaiApiKey = core.getInput("openai-api-key") || "";
  const anthropicApiKey = core.getInput("anthropic-api-key") || "";
  const model = core.getInput("model") || "gpt-4o";
  const requiredLabel = core.getInput("required-label") || "autofix";
  const baseBranchInput = core.getInput("base-branch") || "";
  const testCommandSpecificFallback = core.getInput("test-command-specific") || "";
  const testCommandSuiteFallback = core.getInput("test-command-suite") || "";
  const aiderVersion = core.getInput("aider-version") || "";
  const workingDirectoryInput = core.getInput("working-directory") || "";

  // Validate at least one API key is provided
  if (!openaiApiKey.trim() && !anthropicApiKey.trim()) {
    throw new Error("At least one of openai-api-key or anthropic-api-key must be provided");
  }

  let owner: string | undefined;
  let repo: string | undefined;
  let issueNumber: number | undefined;
  let octokit: ReturnType<typeof github.getOctokit> | undefined;

  try {
    if (github.context.eventName !== "issues") {
      core.info(`Event ${github.context.eventName} is not supported. Skipping.`);
      return;
    }

    const issue = (
      github.context.payload as { issue?: { number?: number; labels?: Array<string | { name?: string }> } }
    )?.issue;
    issueNumber = issue?.number;
    if (!issueNumber) throw new Error("No issue number found in the event payload.");

    const labels: string[] = Array.isArray(issue?.labels)
      ? issue.labels.map((l) => (typeof l === "string" ? l : l?.name)).filter((n): n is string => typeof n === "string")
      : [];

    if (requiredLabel && !labels.includes(requiredLabel)) {
      core.info(`Issue #${issueNumber} does not have label '${requiredLabel}'. Skipping.`);
      return;
    }

    ({ owner, repo } = github.context.repo);
    octokit = github.getOctokit(ghToken);

    const issueResponse = await octokit.rest.issues.get({ owner, repo, issue_number: issueNumber });
    const issueTitle = issueResponse.data.title ?? "";
    const issueBody = issueResponse.data.body ?? "";

    const userStoryRefRaw =
      extractIssueFormFieldValue(issueBody, "User story issue (reference)") ??
      extractIssueFormFieldValue(issueBody, "User story issue") ??
      "";
    const testCaseRefRaw =
      extractIssueFormFieldValue(issueBody, "Test case issue (reference)") ??
      extractIssueFormFieldValue(issueBody, "Test case issue") ??
      "";

    // Extract test commands from issue body, fallback to action inputs
    const testCommandSpecific =
      extractIssueFormFieldValue(issueBody, "Test command (specific test for this bug)") || testCommandSpecificFallback;
    const testCommandSuite =
      extractIssueFormFieldValue(issueBody, "Test command (full suite for regression)") || testCommandSuiteFallback;

    // Extract branch from issue body (takes priority over base-branch input)
    const issueBranch = extractIssueFormFieldValue(issueBody, "Branch where bug was discovered") || "";

    const userStoryRef = parseGitHubIssueRef({
      input: userStoryRefRaw,
      defaultOwner: owner,
      defaultRepo: repo,
    });
    const testCaseRef = parseGitHubIssueRef({
      input: testCaseRefRaw,
      defaultOwner: owner,
      defaultRepo: repo,
    });

    const referencedContexts: string[] = [];
    if (userStoryRef) {
      try {
        const refIssue = await octokit.rest.issues.get({
          owner: userStoryRef.owner,
          repo: userStoryRef.repo,
          issue_number: userStoryRef.number,
        });
        referencedContexts.push(
          "REFERENCED USER STORY ISSUE\n" +
            `URL: ${userStoryRef.url}\n` +
            `Title: ${refIssue.data.title ?? ""}\n\n` +
            `Body:\n${refIssue.data.body ?? ""}\n`
        );
      } catch (e) {
        core.warning(
          `Failed to fetch referenced user story issue (${userStoryRef.url}). Continuing without it. ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }

    if (testCaseRef) {
      try {
        const refIssue = await octokit.rest.issues.get({
          owner: testCaseRef.owner,
          repo: testCaseRef.repo,
          issue_number: testCaseRef.number,
        });
        referencedContexts.push(
          "REFERENCED TEST CASE ISSUE\n" +
            `URL: ${testCaseRef.url}\n` +
            `Title: ${refIssue.data.title ?? ""}\n\n` +
            `Body:\n${refIssue.data.body ?? ""}\n`
        );
      } catch (e) {
        core.warning(
          `Failed to fetch referenced test case issue (${testCaseRef.url}). Continuing without it. ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }

    const issueBodyForPrompt = truncate(
      issueBody + (referencedContexts.length ? `\n\n${referencedContexts.join("\n\n")}` : ""),
      180_000
    );

    const repoResponse = await octokit.rest.repos.get({ owner, repo });
    const defaultBranch = repoResponse.data.default_branch;
    // Priority: issue branch field > action input > repo default
    const baseBranch = issueBranch.trim() || baseBranchInput.trim() || defaultBranch;

    const repoRoot = process.cwd();
    const workingDirectory = workingDirectoryInput.trim() ? `${repoRoot}/${workingDirectoryInput.trim()}` : repoRoot;

    // Run SPECIFIC test BEFORE generating the fix to capture failure output for the prompt
    let testFailureOutput: string | undefined;
    if (testCommandSpecific.trim()) {
      core.info(`Running specific test to capture failure output: ${testCommandSpecific}`);
      const preTestRes = exec(testCommandSpecific, { silent: true, cwd: workingDirectory });
      if (preTestRes.exitCode !== 0) {
        testFailureOutput = truncate((preTestRes.stdout + "\n" + preTestRes.stderr).trim(), 15_000);
        core.info("Specific test failed (expected for bug). Including failure output in prompt context.");
      } else {
        core.info("Specific test passed before fix - no failure output to include.");
      }
    } else {
      core.info("No specific test command provided; skipping pre-fix test.");
    }

    // Install Aider
    installAider(aiderVersion);

    // Checkout base branch and create working branch BEFORE running Aider
    core.info(`Checking out base branch ${baseBranch} and creating working branch...`);
    exec(`git fetch origin ${shellEscape(baseBranch)}`);
    exec(`git checkout ${shellEscape(baseBranch)}`);
    exec(`git pull --ff-only origin ${shellEscape(baseBranch)}`);

    const branchName = `qa/issue-${issueNumber}-${Date.now()}`;
    exec(`git checkout -b ${shellEscape(branchName)}`);

    // Build the prompt for Aider
    const prompt = buildAiderPrompt({
      issueTitle,
      issueBody: issueBodyForPrompt,
      testFailureOutput,
    });

    // Run Aider - it will modify files directly
    const aiderResult = runAider({
      prompt,
      repoRoot,
      workingDirectory: workingDirectory !== repoRoot ? workingDirectory : undefined,
      openaiApiKey: openaiApiKey || undefined,
      anthropicApiKey: anthropicApiKey || undefined,
      model,
    });

    core.info("=== AIDER OUTPUT ===");
    core.info(truncate(aiderResult.stdout, 4000));
    if (aiderResult.stderr) {
      core.info("=== AIDER STDERR ===");
      core.info(truncate(aiderResult.stderr, 2000));
    }
    core.info("=== END AIDER OUTPUT ===");

    if (aiderResult.exitCode !== 0) {
      await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: issueNumber,
        body:
          "Aider failed to generate a fix.\n\n" +
          "Output:\n" +
          `\n\n\`\`\`\n${truncate((aiderResult.stdout + "\n" + aiderResult.stderr).trim(), 6000)}\n\`\`\`\n`,
      });
      core.setFailed("Aider failed to generate a fix.");
      return;
    }

    // Check if Aider made any changes
    const status = exec("git status --porcelain", { silent: true }).stdout.trim();
    if (!status) {
      await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: issueNumber,
        body: "Aider analyzed the issue but made no file changes. No PR was created.",
      });
      return;
    }

    core.info(`Files changed:\n${status}`);

    // Run FULL TEST SUITE after Aider fix to check for regressions
    if (testCommandSuite.trim()) {
      core.info(`Running full test suite for regression check: ${testCommandSuite}`);
      const testRes = exec(testCommandSuite, { silent: true, cwd: workingDirectory });
      if (testRes.exitCode !== 0) {
        await octokit.rest.issues.createComment({
          owner,
          repo,
          issue_number: issueNumber,
          body:
            "Aider generated a fix, but the full test suite failed (regression detected). PR not opened.\n\n" +
            "Test output:\n" +
            `\n\n\`\`\`\n${truncate((testRes.stdout + "\n" + testRes.stderr).trim(), 8000)}\n\`\`\`\n`,
        });
        core.setFailed("Full test suite failed (regression); PR not opened.");
        return;
      }
      core.info("Full test suite passed - no regressions detected.");
    } else {
      core.info("No full test suite command provided; proceeding to open PR.");
    }

    core.info("Committing changes...");
    exec('git config user.name "github-actions[bot]"');
    exec('git config user.email "41898282+github-actions[bot]@users.noreply.github.com"');

    exec("git add -A");
    exec(`git commit -m ${shellEscape(`Fix: issue #${issueNumber}`)}`);

    core.info("Pushing branch...");
    exec(`git push --set-upstream origin ${shellEscape(branchName)}`);

    core.info("Creating PR...");
    let pr;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        pr = await octokit.rest.pulls.create({
          owner,
          repo,
          title: `Fix: ${issueTitle}`.slice(0, 240),
          head: branchName,
          base: baseBranch,
          body: `Automated fix for issue #${issueNumber} using Aider.\n\nCloses #${issueNumber}.`,
        });
        break;
      } catch (e) {
        if (attempt === 2) throw e;
        core.warning(`PR creation failed (attempt ${attempt + 1}/3), retrying in 2s...`);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    if (!pr) throw new Error("Failed to create PR after 3 attempts");

    const prUrl = pr.data.html_url;
    core.setOutput("pr-url", prUrl);

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await octokit.rest.issues.createComment({
          owner,
          repo,
          issue_number: issueNumber,
          body: `I opened a PR for this issue: ${prUrl}`,
        });
        break;
      } catch (e) {
        if (attempt === 2) core.warning(`Failed to comment on issue: ${e}`);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  } catch (err) {
    if (octokit && owner && repo && issueNumber) {
      try {
        const msg = err instanceof Error ? err.message : String(err);
        await octokit.rest.issues.createComment({
          owner,
          repo,
          issue_number: issueNumber,
          body: `I couldn't complete the automated fix due to an unexpected error.\n\n\`\`\`\n${truncate(msg, 6000)}\n\`\`\`\n`,
        });
      } catch {
        // If commenting fails, fall back to failing the action.
      }
    }
    throw err;
  }
}

run().catch((err) => {
  core.setFailed(err instanceof Error ? err.message : String(err));
});
