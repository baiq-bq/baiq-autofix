import * as core from "@actions/core";
import * as github from "@actions/github";
import * as path from "path";
import * as fs from "fs";
import OpenAI from "openai";

import {
  extractIssueFormFieldValue,
  parseGitHubIssueRef,
  resolveBaseBranch,
  stripIssueSections,
  truncate,
} from "./lib";
import { exec, shellEscape } from "./utils";
import { getAgent, isValidAgentType, DEFAULT_CODEX_MODEL, DEFAULT_AIDER_MODEL } from "./agents";
import type { AgentType } from "./agents";

const ISSUE_COMMENT_CHUNK_SIZE = 60_000;

async function postCommentWithChunks(params: {
  octokit: ReturnType<typeof github.getOctokit>;
  owner: string;
  repo: string;
  issueNumber: number;
  body: string;
}): Promise<void> {
  const { octokit, owner, repo, issueNumber, body } = params;
  if (body.length <= ISSUE_COMMENT_CHUNK_SIZE) {
    await octokit.rest.issues.createComment({ owner, repo, issue_number: issueNumber, body });
    return;
  }

  const totalChunks = Math.ceil(body.length / ISSUE_COMMENT_CHUNK_SIZE);
  for (let i = 0; i < totalChunks; i++) {
    const chunk = body.slice(i * ISSUE_COMMENT_CHUNK_SIZE, (i + 1) * ISSUE_COMMENT_CHUNK_SIZE);
    const prefix = `Log chunk ${i + 1}/${totalChunks}\n\n`;
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body: `${prefix}${chunk}`,
    });
  }
}

function buildAgentPrompt(params: {
  issueTitle: string;
  issueBody: string;
  agentType: AgentType;
  testFailureOutput?: string;
  retryAttempt?: number;
  previousTestFailure?: string;
}): string {
  let prompt =
    "You are fixing a bug in this codebase based on a GitHub bug report issue.\n\n" +
    "The bug report structure is:\n" +
    "- TEST CASE: describes preconditions, step-by-step actions, and expected result\n" +
    "- BUG DESCRIPTION: explains expected vs actual behavior (the bug)\n\n" +
    `ISSUE TITLE: ${params.issueTitle}\n\n` +
    `ISSUE BODY:\n${params.issueBody}\n\n`;

  if (params.testFailureOutput) {
    prompt += "TEST FAILURE OUTPUT (from running the specific test before fix):\n" + `${params.testFailureOutput}\n\n`;
  }

  if (params.retryAttempt && params.retryAttempt > 0 && params.previousTestFailure) {
    prompt +=
      `IMPORTANT: This is retry attempt #${params.retryAttempt + 1}. The previous fix attempt failed the tests.\n` +
      "PREVIOUS TEST FAILURE OUTPUT:\n" +
      `${params.previousTestFailure}\n\n` +
      "Please analyze why the previous fix was incorrect and provide a different solution.\n\n";
  }

  prompt +=
    "YOUR TASK:\n" +
    "1. Analyze the bug report and test failure output\n" +
    "2. Find the root cause of the bug in the codebase\n" +
    "3. Apply all necessary fixes so that the actual behavior fully matches the expected behavior. Ensure the solution is correct, efficient, and follows best practices\n" +
    "4. Do NOT modify lockfiles (package-lock.json, pnpm-lock.yaml, yarn.lock) or .github/workflows/*\n" +
    "5. Do NOT add unnecessary changes - keep the fix focused and minimal\n\n" +
    "IMPORTANT RESTRICTIONS:\n" +
    (params.agentType === "aider" ? "" : "- Do NOT run any tests - the CI system will run them\n") +
    "- Do NOT run git commands (no git add, git commit, git push) - the CI system handles all git operations\n" +
    "- ONLY modify the source files needed to fix the bug";

  return prompt;
}

async function generatePRDescription(params: {
  issueTitle: string;
  issueBody: string;
  changedFiles: { path: string; content: string }[];
  diff: string;
  openaiApiKey: string;
  model: string;
}): Promise<string> {
  const openai = new OpenAI({ apiKey: params.openaiApiKey });

  const filesContent = params.changedFiles.map((f) => `=== FILE: ${f.path} ===\n${f.content}`).join("\n\n");

  const prompt = `You are a senior software engineer writing a pull request description for a bug fix.

BUG REPORT:
Title: ${params.issueTitle}

${params.issueBody}

CHANGED FILES CONTENT:
${truncate(filesContent, 50_000)}

DIFF:
${truncate(params.diff, 30_000)}

Write a clear and concise PR description with the following sections:
1. **Bug Description**: What was the bug? What was the expected vs actual behavior?
2. **Root Cause**: What was causing this bug in the code?
3. **Solution**: What changes were made and why?
4. **How It Fixes the Bug**: Explain how these specific changes resolve the issue.

Keep each section brief but informative. Use markdown formatting.`;

  core.info("Generating PR description using OpenAI...");

  const response = await openai.chat.completions.create({
    model: params.model,
    messages: [{ role: "user", content: prompt }],
    max_tokens: 2000,
    temperature: 0.3,
  });

  const description = response.choices[0]?.message?.content?.trim() || "";
  if (!description) {
    core.warning("OpenAI returned empty description, using default.");
    return "";
  }

  core.info("PR description generated successfully.");
  return description;
}

async function run(): Promise<void> {
  const ghToken = core.getInput("github-token", { required: true });
  const agentInput = core.getInput("agent") || "aider";
  const openaiApiKey = core.getInput("openai-api-key") || "";
  const anthropicApiKey = core.getInput("anthropic-api-key") || "";
  const aiderModel = core.getInput("aider-model") || DEFAULT_AIDER_MODEL;
  const codexModel = core.getInput("codex-model") || DEFAULT_CODEX_MODEL;
  const requiredLabel = core.getInput("required-label") || "autofix";
  const baseBranchInput = core.getInput("base-branch") || "";
  const testCommandSpecificFallback = core.getInput("test-command-specific") || "";
  const testCommandSuiteFallback = core.getInput("test-command-suite") || "";
  const aiderVersion = core.getInput("aider-version") || "";
  const codexVersion = core.getInput("codex-version") || "";
  const workingDirectoryInput = core.getInput("working-directory") || "";
  const retryMaxParsed = parseInt(core.getInput("retry-max") || "3", 10);
  const retryMax = Number.isNaN(retryMaxParsed) ? 3 : Math.max(1, retryMaxParsed);
  const addDescription = core.getInput("add-description") !== "false";
  const descriptionModel = core.getInput("description-model") || "gpt-4o";

  // Validate agent type
  if (!isValidAgentType(agentInput)) {
    throw new Error(`Invalid agent type: ${agentInput}. Must be 'codex' or 'aider'.`);
  }
  const agentType: AgentType = agentInput;
  const agent = getAgent(agentType);
  const model = agentType === "codex" ? codexModel : aiderModel;
  const agentVersion = agentType === "codex" ? codexVersion : aiderVersion;

  core.info(`Using agent: ${agentType} with model: ${model}`);

  // Validate API keys based on agent type
  if (agentType === "codex" && !openaiApiKey.trim()) {
    throw new Error("openai-api-key is required when using codex agent");
  }
  if (agentType === "aider" && !openaiApiKey.trim() && !anthropicApiKey.trim()) {
    throw new Error("At least one of openai-api-key or anthropic-api-key must be provided when using aider agent");
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

    const testCaseRef = parseGitHubIssueRef({
      input: testCaseRefRaw,
      defaultOwner: owner,
      defaultRepo: repo,
    });

    const referencedContexts: string[] = [];
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

    const issueBodyWithoutUserStory = stripIssueSections(issueBody, [
      "User story issue (reference)",
      "User story issue",
    ]);

    const issueBodyForPrompt = truncate(
      issueBodyWithoutUserStory + (referencedContexts.length ? `\n\n${referencedContexts.join("\n\n")}` : ""),
      180_000
    );

    const repoResponse = await octokit.rest.repos.get({ owner, repo });
    const defaultBranch = repoResponse.data.default_branch;
    // Priority: base-branch input (forced) > issue branch field > repo default
    const baseBranch = resolveBaseBranch({ issueBranch, baseBranchInput, defaultBranch });

    // Validate base branch exists early to avoid later PR creation failure.
    // `git.getRef` expects refs like `heads/<branch>`
    try {
      await octokit.rest.git.getRef({ owner, repo, ref: `heads/${baseBranch}` });
    } catch {
      const msg =
        `Base branch '${baseBranch}' does not exist in ${owner}/${repo}. ` +
        "Set the action input 'base-branch' to a valid branch name (recommended: the repo default branch), " +
        "or ensure the issue field 'Branch where bug was discovered' matches an existing branch.";
      core.setFailed(msg);
      await postCommentWithChunks({
        octokit,
        owner,
        repo,
        issueNumber,
        body: msg,
      });
      return;
    }

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

    // Install the selected agent
    agent.install(agentVersion);

    // Checkout base branch and create working branch BEFORE running agent
    core.info(`Checking out base branch ${baseBranch} and creating working branch...`);
    exec(`git fetch origin ${shellEscape(baseBranch)}`);
    exec(`git checkout ${shellEscape(baseBranch)}`);
    exec(`git pull --ff-only origin ${shellEscape(baseBranch)}`);

    const branchName = `qa/issue-${issueNumber}-${Date.now()}`;
    exec(`git checkout -b ${shellEscape(branchName)}`);

    // Retry loop (manual for Codex) or Single Run (native loop for Aider)
    let fixSucceeded = false;
    let successfulPrompt: string | undefined;

    if (agentType === "aider") {
      core.info("Using Aider with native test-driven repair loop...");

      const prompt = buildAgentPrompt({
        issueTitle,
        issueBody: issueBodyForPrompt,
        agentType,
        testFailureOutput,
      });

      // Chain specific test and suite for Aider's native loop
      // If specific test passes, it will run the suite to check for regressions
      const testCmds = [testCommandSpecific, testCommandSuite].filter((cmd) => cmd.trim()).join(" && ");

      const agentResult = agent.run({
        prompt,
        repoRoot,
        workingDirectory: workingDirectory !== repoRoot ? workingDirectory : undefined,
        openaiApiKey: openaiApiKey || undefined,
        anthropicApiKey: anthropicApiKey || undefined,
        model,
        testCommand: testCmds,
      });

      if (agentResult.exitCode === 0) {
        fixSucceeded = true;
        successfulPrompt = prompt;
        core.info("Aider successfully fixed the bug and passed all tests.");
      } else {
        core.setFailed(`Aider failed to generate a working fix (exit code ${agentResult.exitCode}).`);

        await postCommentWithChunks({
          octokit: octokit!,
          owner: owner!,
          repo: repo!,
          issueNumber: issueNumber!,
          body:
            `Aider failed to fix the bug.\n\n` +
            `Full output:\n\n` +
            `\`\`\`\n${truncate((agentResult.stdout || "") + "\n" + (agentResult.stderr || ""), 20000)}\n\`\`\``,
        });
        return;
      }
    } else {
      // Manual retry loop for Codex (or other agents without native test loop)
      let previousTestFailure: string | undefined;

      for (let attempt = 0; attempt < retryMax; attempt++) {
        if (attempt > 0) {
          core.info(`\n=== RETRY ATTEMPT ${attempt + 1}/${retryMax} ===`);
          // Reset changes from previous failed attempt
          exec("git checkout .", { silent: true });
          exec("git clean -fd", { silent: true });
        }

        // Build the prompt for agent (with retry info if applicable)
        const prompt = buildAgentPrompt({
          issueTitle,
          issueBody: issueBodyForPrompt,
          agentType,
          testFailureOutput,
          retryAttempt: attempt,
          previousTestFailure,
        });

        // Run agent - it will modify files directly
        const agentResult = agent.run({
          prompt,
          repoRoot,
          workingDirectory: workingDirectory !== repoRoot ? workingDirectory : undefined,
          openaiApiKey: openaiApiKey || undefined,
          anthropicApiKey: anthropicApiKey || undefined,
          model,
        });

        core.info(`=== ${agentType.toUpperCase()} OUTPUT ===`);
        core.info(truncate(agentResult.stdout, 4000));
        if (agentResult.stderr) {
          core.info(`=== ${agentType.toUpperCase()} STDERR ===`);
          core.info(truncate(agentResult.stderr, 2000));
        }
        core.info(`=== END ${agentType.toUpperCase()} OUTPUT ===`);

        const fullAgentOutput =
          `Attempt: ${attempt + 1}/${retryMax}\n` +
          `Agent: ${agentType}\n` +
          `Model: ${model}\n` +
          `Working directory: ${workingDirectory}\n` +
          `Exit code: ${agentResult.exitCode}\n\n` +
          `STDOUT:\n${agentResult.stdout || "(empty)"}\n\n` +
          `STDERR:\n${agentResult.stderr || "(empty)"}`;

        if (agentResult.exitCode !== 0) {
          await postCommentWithChunks({
            octokit: octokit!,
            owner: owner!,
            repo: repo!,
            issueNumber: issueNumber!,
            body:
              `${agentType} failed to generate a fix (attempt ${attempt + 1}/${retryMax}).\n\n` +
              `Full ${agentType} output:\n\n` +
              `\`\`\`\n${fullAgentOutput}\n\`\`\``,
          });

          if (attempt === retryMax - 1) {
            core.setFailed(`${agentType} failed to generate a fix.`);
            return;
          }
          core.warning(`${agentType} failed (attempt ${attempt + 1}/${retryMax}), will retry...`);
          previousTestFailure = truncate(fullAgentOutput, 10_000);
          continue;
        }

        // Check if agent made any changes
        const status = exec("git status --porcelain", { silent: true }).stdout.trim();
        if (!status) {
          if (attempt === retryMax - 1) {
            await octokit.rest.issues.createComment({
              owner,
              repo,
              issue_number: issueNumber,
              body: `${agentType} analyzed the issue but made no file changes after ${retryMax} attempt(s). No PR was created.`,
            });
            return;
          }
          core.warning(`${agentType} made no changes (attempt ${attempt + 1}/${retryMax}), will retry...`);
          previousTestFailure = `${agentType} did not make any file changes. Please analyze the issue more carefully and modify the appropriate files.`;
          continue;
        }

        core.info(`Files changed:\n${status}`);

        // Run FULL TEST SUITE after agent fix to check for regressions
        if (testCommandSuite.trim()) {
          core.info(`Running full test suite for regression check: ${testCommandSuite}`);
          const testRes = exec(testCommandSuite, { silent: true, cwd: workingDirectory });
          if (testRes.exitCode !== 0) {
            const testOutput = truncate((testRes.stdout + "\n" + testRes.stderr).trim(), 10_000);
            if (attempt === retryMax - 1) {
              await octokit.rest.issues.createComment({
                owner,
                repo,
                issue_number: issueNumber,
                body:
                  `${agentType} generated a fix, but the full test suite failed after ${retryMax} attempt(s). PR not opened.\n\n` +
                  "Test output:\n" +
                  `\n\n\`\`\`\n${truncate(testOutput, 8000)}\n\`\`\`\n`,
              });
              core.setFailed(`Full test suite failed after ${retryMax} attempt(s); PR not opened.`);
              return;
            }
            core.warning(`Tests failed (attempt ${attempt + 1}/${retryMax}), will retry with failure info...`);
            previousTestFailure = testOutput;
            continue;
          }
          core.info("Full test suite passed - no regressions detected.");
        } else if (testCommandSpecific.trim()) {
          // No full test suite, but specific test is available - run it to verify the fix
          core.info(`No full test suite; running specific test to verify fix: ${testCommandSpecific}`);
          const testRes = exec(testCommandSpecific, { silent: true, cwd: workingDirectory });
          if (testRes.exitCode !== 0) {
            const testOutput = truncate((testRes.stdout + "\n" + testRes.stderr).trim(), 10_000);
            if (attempt === retryMax - 1) {
              await octokit.rest.issues.createComment({
                owner,
                repo,
                issue_number: issueNumber,
                body:
                  `${agentType} generated a fix, but the specific test still failed after ${retryMax} attempt(s). PR not opened.\n\n` +
                  "Test output:\n" +
                  `\n\n\`\`\`\n${truncate(testOutput, 8000)}\n\`\`\`\n`,
              });
              core.setFailed(`Specific test failed after ${retryMax} attempt(s); PR not opened.`);
              return;
            }
            core.warning(`Specific test failed (attempt ${attempt + 1}/${retryMax}), will retry with failure info...`);
            previousTestFailure = testOutput;
            continue;
          }
          core.info("Specific test passed - fix verified.");
        } else {
          core.info("No test commands provided; proceeding to open PR.");
        }

        // If we reach here, fix succeeded
        fixSucceeded = true;
        successfulPrompt = prompt;
        break;
      }
    }

    if (!fixSucceeded) {
      core.setFailed(`Failed to generate a working fix after ${retryMax} attempts.`);
      return;
    }

    // Get changed files list and diff before committing
    const changedFilesList = exec("git diff --name-only", { silent: true }).stdout.trim().split("\n").filter(Boolean);
    const diff = exec("git diff", { silent: true }).stdout;

    // Read content of changed files
    const changedFiles: { path: string; content: string }[] = [];
    for (const filePath of changedFilesList) {
      try {
        const fullPath = path.join(repoRoot, filePath);
        const content = fs.readFileSync(fullPath, "utf8");
        changedFiles.push({ path: filePath, content: truncate(content, 20_000) });
      } catch {
        core.warning(`Could not read changed file: ${filePath}`);
      }
    }

    core.info("Committing changes...");
    exec('git config user.name "github-actions[bot]"');
    exec('git config user.email "41898282+github-actions[bot]@users.noreply.github.com"');

    exec("git add -A");
    exec(`git commit -m ${shellEscape(`Fix: issue #${issueNumber}`)}`);

    // Generate PR description using OpenAI if enabled
    let prBody = `Automated fix for issue #${issueNumber} using ${agentType}.\n\nCloses #${issueNumber}.`;
    if (addDescription && openaiApiKey.trim()) {
      try {
        const generatedDescription = await generatePRDescription({
          issueTitle,
          issueBody: issueBodyForPrompt,
          changedFiles,
          diff,
          openaiApiKey,
          model: descriptionModel,
        });
        if (generatedDescription) {
          prBody = `${generatedDescription}\n\n---\n\nCloses #${issueNumber}.`;
        }
      } catch (e) {
        core.warning(`Failed to generate PR description: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else if (addDescription && !openaiApiKey.trim()) {
      core.warning("PR description generation requires OpenAI API key. Using default description.");
    }

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
          body: prBody,
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
          body:
            `I opened a PR for this issue: ${prUrl}\n\n` +
            `<details>\n<summary>Full prompt sent to ${agentType}</summary>\n\n` +
            `\`\`\`\n${truncate(successfulPrompt ?? "", 60000)}\n\`\`\`\n</details>`,
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
