import * as core from "@actions/core";
import * as github from "@actions/github";
import OpenAI from "openai";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

import {
  countLines,
  extractDiffOnly as extractDiffOnlyFromModel,
  extractIssueFormFieldValue,
  parseGitHubIssueRef,
  safeRepoRelativePath,
  truncate,
  validateDiff,
} from "./lib";

type ExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

function shellEscape(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

function exec(cmd: string, opts?: { silent?: boolean }): ExecResult {
  try {
    const stdout = execSync(cmd, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    if (!opts?.silent) core.info(cmd);
    return { stdout, stderr: "", exitCode: 0 };
  } catch (err: any) {
    const stdout = err?.stdout?.toString?.() ?? "";
    const stderr = err?.stderr?.toString?.() ?? err?.message ?? "";
    if (!opts?.silent) core.info(cmd);
    return { stdout, stderr, exitCode: err?.status ?? 1 };
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateText(params: {
  client: OpenAI;
  model: string;
  instructions: string;
  input: string;
  temperature?: number;
  maxRetries?: number;
}): Promise<string> {
  const maxRetries = params.maxRetries ?? 3;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await params.client.responses.create({
        model: params.model,
        instructions: params.instructions,
        input: params.input,
        temperature: params.temperature,
      });

      const text = res.output_text;
      if (typeof text === "string" && text.trim()) return text;

      throw new Error("OpenAI Responses API returned no output_text.");
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const isRetryable =
        lastError.message.includes("rate_limit") ||
        lastError.message.includes("timeout") ||
        lastError.message.includes("503") ||
        lastError.message.includes("502") ||
        lastError.message.includes("500");

      if (!isRetryable || attempt === maxRetries - 1) {
        throw lastError;
      }

      const delayMs = Math.min(1000 * Math.pow(2, attempt), 10000);
      core.warning(
        `OpenAI request failed (attempt ${attempt + 1}/${maxRetries}), retrying in ${delayMs}ms: ${lastError.message}`
      );
      await sleep(delayMs);
    }
  }

  throw lastError ?? new Error("generateText failed with no error captured");
}

async function askForFilesToRead(params: {
  client: OpenAI;
  model: string;
  issueTitle: string;
  issueBody: string;
  fileList: string;
  testFailureOutput?: string;
}): Promise<string[]> {
  const prompt =
    "You are an assistant that helps fix bugs in a repository based on a GitHub bug report issue. " +
    "The bug report contains: " +
    "(1) a reference to a USER STORY issue describing the requirement, " +
    "(2) a reference to a TEST CASE issue describing preconditions, steps, and expected result, " +
    "(3) a BUG DESCRIPTION explaining expected vs actual behavior. " +
    "If automated tests exist, the TEST FAILURE OUTPUT is also provided showing the actual test errors. " +
    "Given the issue and repository file list, choose up to 8 files that are most relevant to inspect for fixing the bug. " +
    'Return ONLY valid JSON of the form: {"files":["path1","path2"]}.';

  let input =
    `Issue title:\n${params.issueTitle}\n\n` +
    `Issue body:\n${params.issueBody}\n\n` +
    `Repository file list (git ls-files):\n${params.fileList}`;

  if (params.testFailureOutput) {
    input += `\n\nTEST FAILURE OUTPUT:\n${params.testFailureOutput}`;
  }

  const text = await generateText({
    client: params.client,
    model: params.model,
    instructions: prompt,
    input,
    temperature: 0,
  });
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`Failed to parse file selection JSON. Model output:\n${text}`);
    parsed = JSON.parse(match[0]);
  }

  const files = Array.isArray(parsed?.files) ? parsed.files : [];
  return files
    .filter((f: unknown): f is string => typeof f === "string")
    .map((f: string) => f.trim())
    .filter(Boolean)
    .slice(0, 8);
}

async function askForUnifiedDiff(params: {
  client: OpenAI;
  model: string;
  issueTitle: string;
  issueBody: string;
  fileContext: string;
  testFailureOutput?: string;
}): Promise<string> {
  const system =
    "You are an expert software engineer fixing a bug based on a GitHub bug report. " +
    "The bug report structure is: " +
    "(1) USER STORY: describes the requirement/feature being tested, " +
    "(2) TEST CASE: describes preconditions, step-by-step actions, and expected result, " +
    "(3) BUG DESCRIPTION: explains expected vs actual behavior (the bug). " +
    "If automated tests exist, the TEST FAILURE OUTPUT shows the actual test errors that need to be fixed. " +
    "Your task: generate a minimal fix so the actual behavior matches the expected behavior from the test case. " +
    "Return ONLY a unified diff that can be applied with `git apply`. " +
    "Do not include explanations, markdown fences, or extra text. " +
    "Do not modify lockfiles (package-lock.json, pnpm-lock.yaml, yarn.lock) or .github/workflows/*.";

  let input =
    `Issue title:\n${params.issueTitle}\n\n` +
    `Issue body:\n${params.issueBody}\n\n` +
    `Repository context (selected file contents):\n${params.fileContext}`;

  if (params.testFailureOutput) {
    input += `\n\nTEST FAILURE OUTPUT:\n${params.testFailureOutput}`;
  }

  const text = await generateText({
    client: params.client,
    model: params.model,
    instructions: system,
    input,
    temperature: 0,
  });

  return text.trim();
}

async function run(): Promise<void> {
  const ghToken = core.getInput("github-token", { required: true });
  const openaiApiKey = core.getInput("openai-api-key", { required: true });
  const model = core.getInput("model") || "gpt-5.1-codex-max";
  const requiredLabel = core.getInput("required-label") || "autofix";
  const baseBranchInput = core.getInput("base-branch") || "";
  const testCommandSpecificFallback = core.getInput("test-command-specific") || "";
  const testCommandSuiteFallback = core.getInput("test-command-suite") || "";
  const maxDiffLines = Number(core.getInput("max-diff-lines") || "800");

  let owner: string | undefined;
  let repo: string | undefined;
  let issueNumber: number | undefined;
  let octokit: ReturnType<typeof github.getOctokit> | undefined;

  try {
    if (!Number.isFinite(maxDiffLines) || maxDiffLines <= 0) {
      throw new Error("Input max-diff-lines must be a positive number");
    }

    if (github.context.eventName !== "issues") {
      core.info(`Event ${github.context.eventName} is not supported. Skipping.`);
      return;
    }

    const issue = (github.context.payload as any)?.issue;
    issueNumber = issue?.number;
    if (!issueNumber) throw new Error("No issue number found in the event payload.");

    const labels: string[] = Array.isArray(issue?.labels)
      ? issue.labels
          .map((l: any) => (typeof l === "string" ? l : l?.name))
          .filter((n: unknown): n is string => typeof n === "string")
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

    const fileListRaw = exec("git ls-files", { silent: true }).stdout;
    const fileList = truncate(fileListRaw, 120_000);

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

    const client = new OpenAI({ apiKey: openaiApiKey });

    core.info("Selecting files to read...");
    const filesToRead = await askForFilesToRead({
      client,
      model,
      issueTitle,
      issueBody: issueBodyForPrompt,
      fileList,
      testFailureOutput,
    });

    if (filesToRead.length === 0) {
      throw new Error("Model did not select any files to read.");
    }

    core.info(`Selected files: ${filesToRead.join(", ")}`);

    const selectedContexts: string[] = [];
    for (const rel of filesToRead) {
      const resolved = safeRepoRelativePath(repoRoot, rel);
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) continue;

      const raw = fs.readFileSync(resolved, "utf8");
      const snippet = truncate(raw, 12_000);
      selectedContexts.push(`FILE: ${rel}\n-----\n${snippet}\n-----\n`);
    }

    const fileContext = truncate(selectedContexts.join("\n"), 220_000);

    core.info("Generating diff...");
    const modelOutput = await askForUnifiedDiff({
      client,
      model,
      issueTitle,
      issueBody: issueBodyForPrompt,
      fileContext,
      testFailureOutput,
    });

    const diff = extractDiffOnlyFromModel(modelOutput);
    validateDiff(diff);

    const diffLines = countLines(diff);
    if (diffLines > maxDiffLines) {
      throw new Error(`Generated diff is too large: ${diffLines} lines (max ${maxDiffLines}).`);
    }

    core.info(`Checking out base branch ${baseBranch} and creating working branch...`);
    exec(`git fetch origin ${shellEscape(baseBranch)}`);
    exec(`git checkout ${shellEscape(baseBranch)}`);
    exec(`git pull --ff-only origin ${shellEscape(baseBranch)}`);

    const branchName = `qa/issue-${issueNumber}-${Date.now()}`;
    exec(`git checkout -b ${shellEscape(branchName)}`);

    const tmpFile = path.join(repoRoot, `.qa-action-${issueNumber}.diff`);
    fs.writeFileSync(tmpFile, diff, "utf8");

    const applyRes = exec(`git apply --whitespace=fix ${tmpFile}`, { silent: true });
    fs.unlinkSync(tmpFile);

    if (applyRes.exitCode !== 0) {
      await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: issueNumber,
        body:
          "I generated a patch but failed to apply it with `git apply`.\n\n" +
          "Details:\n" +
          `\n\n\`\`\`\n${truncate(applyRes.stderr || applyRes.stdout, 6000)}\n\`\`\`\n`,
      });
      core.setFailed("Failed to apply generated patch.");
      return;
    }

    const status = exec("git status --porcelain", { silent: true }).stdout.trim();
    if (!status) {
      await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: issueNumber,
        body: "I attempted to generate a fix, but it resulted in no file changes. No PR was created.",
      });
      return;
    }

    // Run FULL TEST SUITE after applying fix to check for regressions
    if (testCommandSuite.trim()) {
      core.info(`Running full test suite for regression check: ${testCommandSuite}`);
      const testRes = exec(testCommandSuite, { silent: true });
      if (testRes.exitCode !== 0) {
        await octokit.rest.issues.createComment({
          owner,
          repo,
          issue_number: issueNumber,
          body:
            "I generated a patch and applied it locally, but the full test suite failed (regression detected). PR not opened.\n\n" +
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
      body: `Automated fix for issue #${issueNumber}.\n\nCloses #${issueNumber}.`,
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
