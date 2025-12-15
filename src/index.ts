import * as core from "@actions/core";
import * as github from "@actions/github";
import { execSync, spawnSync } from "child_process";

import { extractIssueFormFieldValue, parseGitHubIssueRef, truncate } from "./lib";

type ExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

function shellEscape(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

function exec(cmd: string, opts?: { silent?: boolean; env?: NodeJS.ProcessEnv }): ExecResult {
  try {
    const stdout = execSync(cmd, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: opts?.env ?? process.env,
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

function installCodexCli(version: string): void {
  core.info(`Installing Codex CLI${version ? ` (version: ${version})` : ""}...`);
  const pkg = version ? `@openai/codex@${version}` : "@openai/codex";
  const res = exec(`npm install -g ${pkg}`, { silent: true });
  if (res.exitCode !== 0) {
    throw new Error(`Failed to install Codex CLI: ${res.stderr || res.stdout}`);
  }
  core.info("Codex CLI installed successfully.");
}

function runCodexExec(params: {
  prompt: string;
  workingDirectory: string;
  openaiApiKey: string;
  model?: string;
}): ExecResult {
  const args = ["exec", "--full-auto"];

  if (params.model) {
    args.push("--model", params.model);
  }

  args.push(params.prompt);

  core.info("Running Codex CLI...");
  core.info(`codex ${args.join(" ")} "<prompt>"`);

  const result = spawnSync("codex", args, {
    cwd: params.workingDirectory,
    encoding: "utf8",
    env: {
      ...process.env,
      OPENAI_API_KEY: params.openaiApiKey,
    },
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 600_000, // 10 minute timeout
  });

  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 1,
  };
}

function buildCodexPrompt(params: { issueTitle: string; issueBody: string; testFailureOutput?: string }): string {
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
  const openaiApiKey = core.getInput("openai-api-key", { required: true });
  const model = core.getInput("model") || "gpt-5.1-codex-max";
  const requiredLabel = core.getInput("required-label") || "autofix";
  const baseBranchInput = core.getInput("base-branch") || "";
  const testCommandSpecificFallback = core.getInput("test-command-specific") || "";
  const testCommandSuiteFallback = core.getInput("test-command-suite") || "";
  const codexVersion = core.getInput("codex-version") || "";

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
    const baseBranch = baseBranchInput.trim() || defaultBranch;

    const repoRoot = process.cwd();

    // Run SPECIFIC test BEFORE generating the fix to capture failure output for the prompt
    let testFailureOutput: string | undefined;
    if (testCommandSpecific.trim()) {
      core.info(`Running specific test to capture failure output: ${testCommandSpecific}`);
      const preTestRes = exec(testCommandSpecific, { silent: true });
      if (preTestRes.exitCode !== 0) {
        testFailureOutput = truncate((preTestRes.stdout + "\n" + preTestRes.stderr).trim(), 15_000);
        core.info("Specific test failed (expected for bug). Including failure output in prompt context.");
      } else {
        core.info("Specific test passed before fix - no failure output to include.");
      }
    } else {
      core.info("No specific test command provided; skipping pre-fix test.");
    }

    // Install Codex CLI
    installCodexCli(codexVersion);

    // Checkout base branch and create working branch BEFORE running Codex
    core.info(`Checking out base branch ${baseBranch} and creating working branch...`);
    exec(`git fetch origin ${shellEscape(baseBranch)}`);
    exec(`git checkout ${shellEscape(baseBranch)}`);
    exec(`git pull --ff-only origin ${shellEscape(baseBranch)}`);

    const branchName = `qa/issue-${issueNumber}-${Date.now()}`;
    exec(`git checkout -b ${shellEscape(branchName)}`);

    // Build the prompt for Codex
    const prompt = buildCodexPrompt({
      issueTitle,
      issueBody: issueBodyForPrompt,
      testFailureOutput,
    });

    // Run Codex CLI - it will modify files directly
    const codexResult = runCodexExec({
      prompt,
      workingDirectory: repoRoot,
      openaiApiKey,
      model: model || undefined,
    });

    core.info("=== CODEX OUTPUT ===");
    core.info(truncate(codexResult.stdout, 4000));
    if (codexResult.stderr) {
      core.info("=== CODEX STDERR ===");
      core.info(truncate(codexResult.stderr, 2000));
    }
    core.info("=== END CODEX OUTPUT ===");

    if (codexResult.exitCode !== 0) {
      await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: issueNumber,
        body:
          "Codex CLI failed to generate a fix.\n\n" +
          "Output:\n" +
          `\n\n\`\`\`\n${truncate((codexResult.stdout + "\n" + codexResult.stderr).trim(), 6000)}\n\`\`\`\n`,
      });
      core.setFailed("Codex CLI failed to generate a fix.");
      return;
    }

    // Check if Codex made any changes
    const status = exec("git status --porcelain", { silent: true }).stdout.trim();
    if (!status) {
      await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: issueNumber,
        body: "Codex analyzed the issue but made no file changes. No PR was created.",
      });
      return;
    }

    core.info(`Files changed:\n${status}`);

    // Run FULL TEST SUITE after Codex fix to check for regressions
    if (testCommandSuite.trim()) {
      core.info(`Running full test suite for regression check: ${testCommandSuite}`);
      const testRes = exec(testCommandSuite, { silent: true });
      if (testRes.exitCode !== 0) {
        await octokit.rest.issues.createComment({
          owner,
          repo,
          issue_number: issueNumber,
          body:
            "Codex generated a fix, but the full test suite failed (regression detected). PR not opened.\n\n" +
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
    const pr = await octokit.rest.pulls.create({
      owner,
      repo,
      title: `Fix: ${issueTitle}`.slice(0, 240),
      head: branchName,
      base: baseBranch,
      body: `Automated fix for issue #${issueNumber} using Codex CLI.\n\nCloses #${issueNumber}.`,
    });

    const prUrl = pr.data.html_url;
    core.setOutput("pr-url", prUrl);

    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body: `I opened a PR for this issue: ${prUrl}`,
    });
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
