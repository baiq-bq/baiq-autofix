# Baiq Autofix

> Automatic bug fixes, powered by **Baiq**, the IA of BQ

Automated bug fixer that creates pull requests from bug reports.

This action listens to an issue bug report (same-repo only), uses OpenAI to generate a patch, applies it, runs tests, and then:

- Opens a PR if tests pass
- Comments on the issue and stops if patch application fails or tests fail

## Inputs

- `github-token` (required)
- `openai-api-key` (required)
- `model` (optional, default: `GPT-5.1-Codex-Max`)
- `required-label` (optional, default: `autofix`)
- `base-branch` (optional, default: repo default branch)
- `test-command` (optional, default: empty; if empty, tests are skipped)
- `max-diff-lines` (optional, default: `800`)

## Outputs

- `pr-url`: URL of the created pull request (only set if a PR is opened)

## Example workflow (in the target repo)

Create `.github/workflows/qa-action.yml`:

```yml
name: QA Autofix

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

      - uses: your-org/qa-action@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          openai-api-key: ${{ secrets.OPENAI_API_KEY }}
          test-command: npm test
```

## Bug report issue form (recommended)

To ensure the action receives consistent context (user story reference, manual test case, and optional automated test failure), add an Issue Form to the target repo:

- Create: `.github/ISSUE_TEMPLATE/bug_report.yml`

Example template (included in this repo):

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
      description: Include command, test path/name, and failure output
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

When a bug is filed using that form, the collected fields become part of the issue body. The action reads the issue body, extracts the user story + test case issue references, fetches those issues, and includes their contents in the prompt context.

To trigger this action, add the `autofix` label (or set `required-label` to a different label).

## Notes

- The workflow must run with `contents: write` and `pull-requests: write` so the action can push branches and create PRs.
- The action only runs when the issue contains the `required-label` label (default: `autofix`).
- If `test-command` is set and tests fail, the action comments on the issue and does not open a PR.

## Development

```bash
npm run typecheck
npm test
npm run build
```

## Publishing

This action runs `dist/index.js`. You must commit the compiled `dist/` output when releasing.
