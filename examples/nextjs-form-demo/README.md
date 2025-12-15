# Next.js form demo (server actions + cross-field validation)

This is a small **intentionally buggy** Next.js demo app you can use to showcase the Baiq Autofix GitHub Action.

## Table of contents

- [Quickstart](#quickstart)
- [E2E tests](#e2e-tests)
- [Wiring the action to run E2E tests](#wiring-the-action-to-run-e2e-tests)
- [Issues to create](#issues-to-create)
  - [Step 1: Create the user story issue](#step-1-create-the-user-story-issue)
  - [Step 2: Create test case issues](#step-2-create-test-case-issues)
  - [Step 3: Create bug report issues](#step-3-create-bug-report-issues)
- [Triggering the action](#triggering-the-action)

---

## Quickstart

```bash
cd examples/nextjs-form-demo
npm install
npm run dev
```

Open `http://localhost:3000`.

---

## E2E tests

This demo includes Playwright E2E tests in `e2e/`:

| Suite | Command | Expected result |
|-------|---------|-----------------|
| **Discovery** (smoke) | `npm run e2e:discovery` | ✅ Passes |
| **Verification** (acceptance) | `npm run e2e:verification` | ❌ Fails (until bugs are fixed) |
| **All** | `npm run e2e` | ❌ Fails (until bugs are fixed) |

### One-time setup

Install Playwright browsers:

```bash
npx playwright install chromium
```

### Running E2E locally

```bash
# Smoke tests (should pass)
npm run e2e:discovery

# Verification tests (expected to fail until bugs are fixed)
npm run e2e:verification

# Interactive UI mode
npm run e2e:ui
```

---

## Wiring the action to run E2E tests

To have the Baiq Autofix action run E2E tests before opening a PR, configure the workflow like this:

```yml
# .github/workflows/autofix-demo.yml
name: Autofix Demo

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
          node-version: "24"
          cache: "npm"

      - name: Install root dependencies
        run: npm ci

      - name: Install demo dependencies
        run: npm ci
        working-directory: examples/nextjs-form-demo

      - name: Install Playwright browsers
        run: npx playwright install chromium --with-deps
        working-directory: examples/nextjs-form-demo

      - name: Run Baiq Autofix
        uses: ./.
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          openai-api-key: ${{ secrets.OPENAI_API_KEY }}
          test-command: npm run e2e --prefix examples/nextjs-form-demo
```

**Key points:**

- `test-command` is set to run the demo's E2E tests.
- Playwright browsers are installed before the action runs.
- If any E2E test fails, the action comments on the issue and does **not** open a PR.

---

## Issues to create

To showcase the action, you need to create **3 types of issues** in order:

### Step 1: Create the user story issue

Create a new issue with title and body below. This describes the feature requirements.

---

**Title:**

```
US-1: Conference registration form
```

**Body:**

```markdown
As a visitor
I want to register for the conference
So that I can reserve a seat and optionally request invoice details.

## Acceptance criteria

- Required fields: `fullName`, `email`, `ticketType`.
- If `ticketType = business`:
  - `companyName` is required.
  - `vatNumber` is required and must be valid **only if** `countryCode` is in the EU.
- If `needsInvoice = true`:
  - `billingAddress1`, `billingCity`, `billingPostalCode`, `billingCountryCode` are required.
- `startDate` and `endDate` must form a valid range:
  - both required
  - `endDate` must be **on or after** `startDate`
- `discountCode`:
  - optional
  - if present, it must be applied correctly to `finalPrice`.

## Related files

- `examples/nextjs-form-demo/lib/validation.ts`
- `examples/nextjs-form-demo/app/submitRegistration.ts`
```

---

### Step 2: Create test case issues

A **test case (TC)** is a detailed step-by-step procedure that QA or E2E must follow to verify a user story requirement. It describes:
- **User story reference** (which requirement is being tested)
- **Preconditions** (setup needed before the test)
- **Steps** (actions to perform)
- **Expected result** (what SHOULD happen if the feature works correctly)
- **E2E test** (automated test that implements this TC)

Create **4 test case issues**:

---

#### TC-1: Validate date range (endDate >= startDate)

**Title:** `TC-1: Validate date range (endDate >= startDate)`

**Body:**

```markdown
## User Story Reference
US-1: Conference registration form

## Preconditions
- Application is running at http://localhost:3000
- Form is accessible

## Steps
1. Navigate to the registration form
2. Fill in "Full name" with "Test User"
3. Fill in "Email" with "test@example.com"
4. Set "Start date" to "2026-06-10"
5. Set "End date" to "2026-06-09" (before start date)
6. Click "Submit registration"

## Expected Result
- Form submission is rejected
- Validation error appears on the "End date" field: "End date must be on or after start date"
- No success message is shown

## E2E Test
`npm run e2e:verification -- --grep "TC-1"`
```

---

#### TC-2: Require all billing fields when invoice is needed

**Title:** `TC-2: Require all billing fields when invoice is needed`

**Body:**

```markdown
## User Story Reference
US-1: Conference registration form

## Preconditions
- Application is running at http://localhost:3000
- Form is accessible

## Steps
1. Navigate to the registration form
2. Fill in "Full name" with "Test User"
3. Fill in "Email" with "test@example.com"
4. Set valid "Start date" and "End date"
5. Check "Needs invoice" checkbox
6. Leave all billing fields empty (billingAddress1, billingCity, billingPostalCode, billingCountryCode)
7. Click "Submit registration"

## Expected Result
- Form submission is rejected
- Validation errors appear for ALL billing fields:
  - billingAddress1: required
  - billingCity: required
  - billingPostalCode: required
  - billingCountryCode: required

## E2E Test
`npm run e2e:verification -- --grep "TC-2"`
```

---

#### TC-3: Require VAT number for EU business tickets

**Title:** `TC-3: Require VAT number for EU business tickets`

**Body:**

```markdown
## User Story Reference
US-1: Conference registration form

## Preconditions
- Application is running at http://localhost:3000
- Form is accessible

## Steps
1. Navigate to the registration form
2. Fill in "Full name" with "Test User"
3. Fill in "Email" with "test@example.com"
4. Set valid "Start date" and "End date"
5. Select "Ticket type" = "Business"
6. Fill in "Company name" with "Test Company"
7. Set "Country code" to "ES" (an EU country)
8. Leave "VAT number" empty
9. Click "Submit registration"

## Expected Result
- Form submission is rejected
- Validation error appears on "VAT number" field: "VAT number is required for EU business registrations"

## E2E Test
`npm run e2e:verification -- --grep "TC-3"`
```

---

#### TC-4: Apply SAVE10 discount code correctly

**Title:** `TC-4: Apply SAVE10 discount code correctly`

**Body:**

```markdown
## User Story Reference
US-1: Conference registration form

## Preconditions
- Application is running at http://localhost:3000
- Form is accessible
- Standard ticket base price is 19900 cents

## Steps
1. Navigate to the registration form
2. Fill in "Full name" with "Test User"
3. Fill in "Email" with "test@example.com"
4. Set valid "Start date" and "End date"
5. Select "Ticket type" = "Standard"
6. Enter "Discount code" = "SAVE10"
7. Click "Submit registration"

## Expected Result
- Form submission succeeds
- Final price displayed is 17910 cents (10% discount applied: 19900 * 0.9 = 17910)

## E2E Test
`npm run e2e:verification -- --grep "TC-4"`
```

---

### Step 3: Create bug report issues

A **bug report** is created when executing a test case produces a **failure** (actual result ≠ expected result). It documents:
- **User story reference** (requirement context)
- **Test case reference** (which TC failed)
- **Bug description** (expected vs actual result explanation)
- **E2E failure output** (automated test error, if exists)

Create **4 bug report issues** using the repo's **Bug report (autofix-ready)** template.

**Important:** After creating each bug report, add the `autofix` label to trigger the action.

---

#### Bug-1: Date range validation error shows on wrong field

**Title:** `Date range validation error shows on wrong field`

Use the bug report template. Fill in:

- **User story issue (reference):** `#<US-1-number>`
- **Test case issue (reference):** `#<TC-1-number>`
- **Bug description:**

```
Expected: Validation error should appear on the "End date" field
Actual: Error appears on "Start date" field instead of "End date"

The date range validation correctly detects invalid ranges, but shows the error on the wrong field.
```

- **Automated test that fails (if exists):**

```
Command: npm run e2e:verification -- --grep "TC-1"
Test: e2e/verification.spec.ts - "TC-1: invalid date range shows endDate error"
Failure: expect(getByTestId('error-endDate')).toBeVisible() - received hidden
```

---

#### Bug-2: billingPostalCode not validated when invoice is needed

**Title:** `billingPostalCode not validated when invoice is needed`

Use the bug report template. Fill in:

- **User story issue (reference):** `#<US-1-number>`
- **Test case issue (reference):** `#<TC-2-number>`
- **Bug description:**

```
Expected: billingPostalCode should be required when "Needs invoice" is checked
Actual: No validation error for billingPostalCode; form accepts empty value

The validation for billing fields is missing the postal code check.
```

- **Automated test that fails (if exists):**

```
Command: npm run e2e:verification -- --grep "TC-2"
Test: e2e/verification.spec.ts - "TC-2: billingPostalCode is required when needsInvoice"
Failure: expect(getByTestId('error-billingPostalCode')).toBeVisible() - received hidden
```

---

#### Bug-3: VAT validation logic is inverted for EU countries

**Title:** `VAT validation logic is inverted for EU countries`

Use the bug report template. Fill in:

- **User story issue (reference):** `#<US-1-number>`
- **Test case issue (reference):** `#<TC-3-number>`
- **Bug description:**

```
Expected: VAT number required for EU business tickets (e.g., countryCode = ES)
Actual: VAT NOT required for EU countries, but required for non-EU (logic is inverted)

The condition checking for EU countries is negated incorrectly.
```

- **Automated test that fails (if exists):**

```
Command: npm run e2e:verification -- --grep "TC-3"
Test: e2e/verification.spec.ts - "TC-3: business + EU country requires VAT"
Failure: expect(getByTestId('error-vatNumber')).toBeVisible() - received hidden
```

---

#### Bug-4: SAVE10 discount adds 10% instead of subtracting

**Title:** `SAVE10 discount adds 10% instead of subtracting`

Use the bug report template. Fill in:

- **User story issue (reference):** `#<US-1-number>`
- **Test case issue (reference):** `#<TC-4-number>`
- **Bug description:**

```
Expected: SAVE10 discount should subtract 10% (final price = 19900 * 0.9 = 17910 cents)
Actual: Final price is 21890 cents (19900 * 1.1) - adds 10% instead of subtracting

The discount calculation multiplies by 1.1 instead of 0.9.
```

- **Automated test that fails (if exists):**

```
Command: npm run e2e:verification -- --grep "TC-4"
Test: e2e/verification.spec.ts - "TC-4: SAVE10 applies 10% discount"
Failure: expect(getByTestId('result-final-price')).toContainText('17910') - received "21890"
```

---

## Triggering the action

1. Create the issues above in order (user story → test cases → bug reports).
2. Add the `autofix` label to a bug report issue.
3. The action will:
   - Read the issue body.
   - Fetch the linked user story and test case issues.
   - Generate a patch using OpenAI.
   - Apply the patch and run `test-command` (E2E tests if configured).
   - If tests pass, open a PR and comment on the issue.
   - If tests fail, comment on the issue with the failure output.

---

## Summary of intentional bugs

| Bug | File | Line | Description |
|-----|------|------|-------------|
| VAT logic inverted | `lib/validation.ts` | ~66 | Requires VAT for non-EU instead of EU |
| Missing postal code validation | `lib/validation.ts` | ~93 | `billingPostalCode` not checked |
| Date comparison correct but error on wrong field | `lib/validation.ts` | ~108-113 | Error shows on `startDate` instead of `endDate` |
| Discount adds instead of subtracts | `lib/validation.ts` | ~168 | `* 1.1` instead of `* 0.9` |
