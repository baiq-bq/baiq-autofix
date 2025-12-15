# Baiq Autofix

> Automatic bug fixes, powered by **Baiq**, the IA of BQ

A GitHub Action that automatically fixes bugs by reading issue context, generating a patch with OpenAI, applying it, running tests, and opening a pull request.

## How it works

1. A bug issue is opened (or labeled with `autofix`).
2. The action reads the issue body and extracts references to a **user story** and a **test case** issue.
3. It fetches those referenced issues and includes them as context for the AI model.
4. The model selects relevant files, generates a unified diff, and the action applies it.
5. If a `test-command` is configured, the action runs tests.
6. If tests pass (or no test command is set), the action opens a PR and comments on the issue.
7. If tests fail or the patch cannot be applied, the action comments on the issue with details.

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `github-token` | ✅ | — | GitHub token (use `secrets.GITHUB_TOKEN`) |
| `openai-api-key` | ✅ | — | OpenAI API key |
| `model` | ❌ | `GPT-5.1-Codex-Max` | OpenAI model to use |
| `required-label` | ❌ | `autofix` | Only run if the issue has this label |
| `base-branch` | ❌ | repo default | Base branch for the PR |
| `test-command` | ❌ | (empty) | Command to run before opening a PR. **Set this to run E2E or unit tests.** |
| `max-diff-lines` | ❌ | `800` | Maximum lines allowed in the generated diff |

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

      - name: Run Baiq Autofix
        uses: baiq-bq/baiq-autofix@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          openai-api-key: ${{ secrets.OPENAI_API_KEY }}
          test-command: npm test
```

### 2. Add the bug report issue template

Create `.github/ISSUE_TEMPLATE/bug_report.yml`:

```yml
name: Bug report (autofix-ready)
description: Bug report including user story + repro + test info
labels:
  - bug
body:
  - type: input
    id: user_story
    attributes:
      label: User story issue (reference)
      description: Link to the user story issue/PR related to this bug
      placeholder: https://github.com/<org>/<repo>/issues/123
    validations:
      required: true

  - type: input
    id: test_case
    attributes:
      label: Test case issue (reference)
      description: Link to the issue that describes the manual test case (steps + expected vs actual)
      placeholder: https://github.com/<org>/<repo>/issues/456
    validations:
      required: true

  - type: textarea
    id: automated_test
    attributes:
      label: Automated test that fails (if exists)
      description: |
        Include command, test path/name, and failure output.
        Example:
        Command: npm run e2e:verification
        Test: e2e/verification.spec.ts - "TC-3: business + EU country requires VAT"
        Output: Expected error-vatNumber to be visible
    validations:
      required: false

  - type: checkboxes
    id: autofix_gate
    attributes:
      label: Autofix gate
      description: Add the `autofix` label after filling this out to trigger the action
      options:
        - label: I confirm this issue contains enough context for an automated fix
          required: false
```

### 3. Add the `OPENAI_API_KEY` secret

Go to **Settings → Secrets and variables → Actions** and add `OPENAI_API_KEY`.

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
    test-command: npm run e2e
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

## Notes

- The workflow must have `contents: write`, `pull-requests: write`, and `issues: write` permissions.
- The action only runs when the issue has the `required-label` (default: `autofix`).
- If `test-command` is set and tests fail, the action comments on the issue and does **not** open a PR.
- The action will not modify lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`) or `.github/workflows/` files.

## Development

```bash
npm run typecheck
npm test
npm run build
```

## Publishing

This action runs `dist/index.js`. You must commit the compiled `dist/` output when releasing.
