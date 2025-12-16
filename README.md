# Baiq Autofix

> **Automatic bug repairs powered by Baiq**, the AI of BQ.

A GitHub Action that autonomously fixes bugs by analyzing issue reports, reproducing failures with tests, and generating code fixes using advanced AI agents (**Aider** or **Codex**).

---

## 🚀 Key Features

- **Autonomous Repair Loop**: Reproduces bugs -> Generates Fix -> Verifies with Tests.
- **Two Powerful Agents**:
  - **Aider** (Default): Full codebase awareness, native test-driven repair loop, supports OpenAI & Anthropic models.
  - **Codex**: OpenAI's specialized Codex CLI agent (`gpt-5-codex`).
- **Context-Aware**: Reads User Story, Test Case, and Bug Description from issue bodies.
- **Regression Testing**: Runs specific bug tests *and* full test suites.
- **Automated PRs**: Opens Pull Requests with AI-generated descriptions explaining the fix.

---

## 📦 Quick Start

### 1. Create the Workflow

Add `.github/workflows/autofix.yml`:

```yaml
name: Autofix

on:
  issues:
    types: [opened, labeled]

permissions:
  contents: write
  pull-requests: write
  issues: write

jobs:
  autofix:
    if: contains(github.event.issue.labels.*.name, 'autofix')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Node (Required)
        uses: actions/setup-node@v4
        with:
          node-version: "22"

      # Python is required for Aider
      - name: Setup Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - name: Install dependencies
        run: npm ci

      - name: Run Baiq Autofix
        uses: baiq-bq/baiq-autofix@v0.3
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          openai-api-key: ${{ secrets.OPENAI_API_KEY }}
          # agent: aider # default
```

### 2. Configure Secrets

Go to **Settings > Secrets and variables > Actions** and add:
- `OPENAI_API_KEY`: Required for `codex` or OpenAI models with `aider`.
- `ANTHROPIC_API_KEY`: Required if using Claude models with `aider`.

### 3. Create Issue Template (Critical)

The action parses structured data from issues. Create `.github/ISSUE_TEMPLATE/bug_report.yml`:

```yaml
name: Bug report (autofix-ready)
description: Report a bug with context for AI repair
labels: [bug]
body:
  - type: input
    id: user_story
    attributes:
      label: User story issue (reference)
      placeholder: "#123"
    validations:
      required: true
  - type: input
    id: test_case
    attributes:
      label: Test case issue (reference)
      placeholder: "#456"
    validations:
      required: true
  - type: textarea
    id: bug_description
    attributes:
      label: Bug description
      description: Explain Expected vs Actual behavior
    validations:
      required: true
  - type: input
    id: branch
    attributes:
      label: Branch where bug was discovered
      placeholder: "main"
  - type: input
    id: test_command_specific
    attributes:
      label: Test command (specific test for this bug)
      description: Command to reproduce THIS specific bug.
      placeholder: 'npm test -- -t "should validate email"'
  - type: input
    id: test_command_suite
    attributes:
      label: Test command (full suite for regression)
      description: Command to run ALL tests.
      placeholder: "npm test"
```

Note: GitHub Issue Forms may insert the placeholder value `_No response_` for optional fields. The action treats `_No response_` as an empty value and will fall back to `base-branch` (if provided) or the repository default branch.

---

## ⚙️ Usage & Configuration

### Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `github-token` | ✅ | - | GitHub token (use `secrets.GITHUB_TOKEN`) |
| `agent` | ❌ | `aider` | AI Agent to use (`aider` or `codex`) |
| `openai-api-key` | ⚠️ | - | Required for `codex` and OpenAI-based `aider` |
| `anthropic-api-key` | ⚠️ | - | Required for Anthropic-based `aider` |
| `aider-model` | ❌ | `gpt-4o` | Model for Aider (e.g., `claude-3-5-sonnet-20241022`) |
| `codex-model` | ❌ | `gpt-5-codex` | Model for Codex |
| `required-label` | ❌ | `autofix` | Action only runs on issues with this label |
| `base-branch` | ❌ | (default) | Base branch for PR. If set, it overrides the issue field `Branch where bug was discovered`. |
| `test-command-specific` | ❌ | - | Fallback specific test command |
| `test-command-suite` | ❌ | - | Fallback full test suite command |
| `retry-max` | ❌ | `3` | Max retries to fix the code if tests fail |
| `add-description` | ❌ | `true` | Generate AI PR description? |
| `working-directory` | ❌ | - | Subdirectory for the project components |

If the resolved base branch does not exist in the repository, the action fails early with a clear error message and posts a comment on the issue.

### Triggering a Fix

1.  Open an issue using the **Bug report** template.
2.  Fill in the **User Story**, **Test Case**, and **Test Commands**.
3.  Add the `autofix` label.
4.  The action will start processing.

---

## 🤖 Agents Explained

### Aider (Recommended)
[Aider](https://github.com/paul-gauthier/aider) is a powerful AI coding assistant that edits code in your local git repository.
-   **Features**: Repository map (understands full context), native test-driven development loop.
-   **Models**: Supports `gpt-4o`, `gpt-4-turbo`, `o1-preview`, `claude-3-5-sonnet-20241022`.
-   **Usage**: Best for complex bugs requiring multiple file changes and deep context.

When using `aider`, the action allows the agent to run tests as part of its native loop.

### Codex
A specialized CLI agent from OpenAI.
-   **Features**: Direct access to `gpt-5-codex`.
-   **Usage**: Good for specific logic fixes or when using `gpt-5-codex` capabilities.

---

## 🔄 How It Works

1.  **Context Extraction**: The action parses the linked User Story and Test Case to understand the *requirement* and the *failure*.
2.  **Reproduction**: It runs the `test-command-specific` *before* applying any fixes to capture the exact error message.
3.  **Agent Execution**:
    -   The Agent receives the Issue Context + Test Failure.
    -   It explores the codebase and modifies files.
4.  **Verification**:
    -   The specific test is run again.
    -   The full `test-command-suite` is run to check for regressions.
5.  **Retry Loop**: If tests fail, the Agent is fed the new error output and asked to retry (up to `retry-max`).
6.  **PR Creation**: On success, it pushes a branch and opens a PR with a description explaining the root cause and solution.

---

## 🛠️ Development

### Building
```bash
npm run build
```
This compiles the TypeScript code into `dist/index.js` which is used by the action.

### Testing
```bash
npm test
```

### Publishing
Ensure you commit the `dist/` directory when releasing a new version.

```bash
git add dist
git commit -m "chore: release vX.X.X"
```
