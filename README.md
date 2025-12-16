# Baiq Autofix

> Automatic bug fixes, powered by **Baiq**, the IA of BQ

A GitHub Action that automatically fixes bugs using AI agents. Supports two agents:
- **Codex** (default): OpenAI's Codex CLI with `gpt-5.2` model
- **Aider**: [Aider](https://github.com/paul-gauthier/aider) with full codebase awareness via its repository map

Both agents are isolated alternatives that can be selected via the `agent` input.

## How it works

1. A bug issue is opened (or labeled with `autofix`).
2. The action reads the issue body and extracts:
   - References to **user story** and **test case** issues
   - **Branch where bug was discovered** (fix will be created from and PR will target this branch)
   - **Specific test command** (for this bug)
   - **Full test suite command** (for regression check)
3. It fetches the referenced issues and includes them as context.
4. **Runs the specific test FIRST** to capture failure output — this gives the AI model the actual test errors.
5. **Aider analyzes the entire codebase** and makes the necessary fixes directly.
6. **Runs tests** after the fix: full test suite if provided, otherwise the specific test to verify the fix.
7. **If tests fail, retries** with failure info added to the prompt (up to `retry-max` attempts).
8. **Generates a PR description** using OpenAI (if `add-description` is enabled) explaining the bug, root cause, and fix.
9. If all tests pass, the action opens a PR and comments on the issue.
10. If tests fail after all retries, the action comments on the issue with details.

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `github-token` | ✅ | — | GitHub token (use `secrets.GITHUB_TOKEN`) |
| `agent` | ❌ | `codex` | Agent to use for fixing bugs (`codex` or `aider`) |
| `openai-api-key` | ⚠️ | — | OpenAI API key (required for Codex, and for Aider with OpenAI models) |
| `anthropic-api-key` | ⚠️ | — | Anthropic API key (required if using Aider with Claude models) |
| `codex-model` | ❌ | `gpt-5.2` | Model to use with Codex agent |
| `aider-model` | ❌ | `gpt-4o` | Model to use with Aider (e.g., `gpt-4o`, `claude-3-5-sonnet-20241022`) |
| `required-label` | ❌ | `autofix` | Only run if the issue has this label |
| `base-branch` | ❌ | repo default | Base branch for the PR |
| `test-command-specific` | ❌ | (empty) | Fallback command for specific bug test (overridden by issue field) |
| `test-command-suite` | ❌ | (empty) | Fallback command for full test suite (overridden by issue field) |
| `codex-version` | ❌ | (latest) | Version of `@openai/codex` to install (only for codex agent) |
| `aider-version` | ❌ | (latest) | Version of `aider-chat` to install (only for aider agent) |
| `working-directory` | ❌ | (repo root) | Working directory for test commands and agent |
| `retry-max` | ❌ | `3` | Maximum retries when tests fail after agent fix |
| `add-description` | ❌ | `true` | Generate AI-powered PR description explaining the bug and fix |
| `description-model` | ❌ | `gpt-4o` | OpenAI model used for generating PR description |

> ⚠️ **Codex agent** requires `openai-api-key`.
> ⚠️ **Aider agent** requires at least one of `openai-api-key` or `anthropic-api-key`.

## Outputs

| Output | Description |
|--------|-------------|
| `pr-url` | URL of the created pull request (only set if a PR is opened) |

## Quick start

### 1. Add the workflow

Create `.github/workflows/autofix.yml` in your repo:

```yml
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

      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "npm"

      - name: Install dependencies
        run: npm ci

      - name: Run Baiq Autofix (with Codex - default)
        uses: baiq-bq/baiq-autofix@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          openai-api-key: ${{ secrets.OPENAI_API_KEY }}
          # agent: codex  # default
          # codex-model: gpt-5.2  # default
          # Test commands can be provided here as fallbacks, but issue fields take priority
          # test-command-specific: npm run test:specific
          # test-command-suite: npm test
```

### 2. Add the bug report issue template

Create `.github/ISSUE_TEMPLATE/bug_report.yml`:

```yml
name: Bug report (autofix-ready)
description: Bug report including user story + test case + bug description + test commands
labels:
  - bug
body:
  - type: input
    id: user_story
    attributes:
      label: User story issue (reference)
      description: Reference to the user story issue (use #123 format or full URL)
      placeholder: "#123"
    validations:
      required: true

  - type: input
    id: test_case
    attributes:
      label: Test case issue (reference)
      description: Reference to the test case that failed (use #123 format or full URL)
      placeholder: "#456"
    validations:
      required: true

  - type: textarea
    id: bug_description
    attributes:
      label: Bug description
      description: Explain the bug - what is the actual result vs expected result?
      placeholder: |
        Expected: <what should happen according to the test case>
        Actual: <what actually happens - the bug>
    validations:
      required: true

  - type: input
    id: branch
    attributes:
      label: Branch where bug was discovered
      description: The branch where the bug was found. The fix will be created from this branch and the PR will target it.
      placeholder: "main"

  - type: input
    id: test_command_specific
    attributes:
      label: Test command (specific test for this bug)
      description: Command to run the specific test. Runs BEFORE fix to capture failure output.
      placeholder: 'npm run e2e:verification -- --grep "TC-1"'

  - type: input
    id: test_command_suite
    attributes:
      label: Test command (full suite for regression)
      description: Command to run the full test suite. Runs AFTER fix to check for regressions.
      placeholder: "npm run e2e"

  - type: checkboxes
    id: autofix_gate
    attributes:
      label: Autofix gate
      description: Add the `autofix` label after filling this out to trigger the action.
      options:
        - label: I confirm this issue contains enough context for an automated fix
          required: false
```

### 3. Add the API key secret

Go to **Settings → Secrets and variables → Actions** and add:
- `OPENAI_API_KEY` — if using OpenAI models (gpt-4o, o1-preview, etc.)
- `ANTHROPIC_API_KEY` — if using Anthropic models (claude-3-5-sonnet, etc.)

### 4. Create issues and trigger the action

1. Create a **user story** issue describing the feature/requirement.
2. Create a **test case** issue describing the steps, expected result, and actual (buggy) result.
3. Create a **bug report** issue using the template, linking to the user story and test case.
4. Add the `autofix` label to the bug report.
5. The action runs, generates a fix, runs tests, and opens a PR if successful.

## Running E2E tests with the action

To have the action run E2E tests (e.g., Playwright) before opening a PR:

1. Set `test-command` to your E2E command, e.g.:
   ```yml
   test-command: npm run e2e
   ```

2. Ensure your workflow installs browsers if needed:
   ```yml
   - name: Install Playwright browsers
     run: npx playwright install chromium --with-deps
   ```

3. If tests fail, the action comments on the issue with the failure output and does **not** open a PR.

### Example with E2E

```yml
- name: Install Playwright browsers
  run: npx playwright install chromium --with-deps

- name: Run Baiq Autofix
  uses: baiq-bq/baiq-autofix@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    openai-api-key: ${{ secrets.OPENAI_API_KEY }}
    working-directory: my-app  # if tests are in a subdirectory
    test-command-suite: npm run e2e
```

## Included demo app

This repo includes an **intentionally buggy** Next.js demo app for showcasing the action:

```
examples/nextjs-form-demo/
```

The demo includes:
- A registration form with cross-field validation
- 4 intentional bugs
- Playwright E2E tests (`discovery` suite passes, `verification` suite fails until bugs are fixed)
- Pre-written user story, test case, and bug report issue texts

See [`examples/nextjs-form-demo/README.md`](examples/nextjs-form-demo/README.md) for full instructions.

### Dogfooding workflow

This repo has a workflow to dogfood the action on itself:

```
.github/workflows/autofix-demo.yml
```

It triggers when an issue is labeled `autofix` and runs `npm test` before opening a PR.

## Agents

### Codex (default)
OpenAI's Codex CLI agent. Requires `openai-api-key`.
- Default model: `gpt-5.2`
- Configure with `codex-model` input

### Aider
[Aider](https://github.com/paul-gauthier/aider) with full codebase awareness via its repository map.

**Supported models for Aider:**

#### OpenAI (requires `openai-api-key`)
- `gpt-4o` (default) — fast, capable, cost-effective
- `gpt-4-turbo` — more capable, higher cost
- `o1-preview` — reasoning model

#### Anthropic (requires `anthropic-api-key`)
- `claude-3-5-sonnet-20241022` — excellent for code
- `claude-3-opus-20240229` — most capable Claude model

**Example using Aider:**
```yml
- name: Setup Python (for Aider)
  uses: actions/setup-python@v5
  with:
    python-version: '3.11'

- name: Run Baiq Autofix with Aider
  uses: baiq-bq/baiq-autofix@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    agent: aider
    openai-api-key: ${{ secrets.OPENAI_API_KEY }}
    aider-model: gpt-4o
```

## Notes

- The workflow must have `contents: write`, `pull-requests: write`, and `issues: write` permissions.
- **Python 3.9+ is required when using Aider** — add `actions/setup-python@v5` to your workflow.
- The action only runs when the issue has the `required-label` (default: `autofix`).
- If a branch is specified in the issue, the fix is created from that branch and the PR targets it.
- If tests fail after the agent makes changes, the action comments on the issue and does **not** open a PR.
- The agent is instructed not to modify lockfiles or `.github/workflows/` files.
- Codex runs with `--approval-mode full-auto` and Aider runs with `--yes-always --no-auto-commits` for non-interactive execution in CI.

## Development

```bash
npm run typecheck
npm test
npm run build
```

## Publishing

This action runs `dist/index.js`. You must commit the compiled `dist/` output when releasing.
