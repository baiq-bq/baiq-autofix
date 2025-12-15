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

Create **4 test case issues**, one for each bug. These describe the manual test steps and expected vs actual behavior.

---

**Title:**
```
## TC-1: Date range validation
```
**Body:**

```markdown
## Steps

1. Open the form at `http://localhost:3000`.
2. Fill in required fields (full name, email).
3. Set `Start date` to `2026-06-10`.
4. Set `End date` to `2026-06-09`.
5. Submit.

## Expected

- The form shows a validation error on `endDate`: "End date must be on or after start date."
- No success confirmation is shown.

## Actual

- (Bug) The form accepts the invalid range and shows success.

## E2E test

```bash
npm run e2e:verification -- --grep "TC-1"
```
```

---

#### TC-2: Invoice required fields

**Title:**

```
TC-2: Invoice required fields
```

**Body:**

```markdown
## Steps

1. Open the form.
2. Fill in required fields (full name, email, dates).
3. Check `Needs invoice`.
4. Leave all billing fields empty.
5. Submit.

## Expected

- Validation errors for: `billingAddress1`, `billingCity`, `billingPostalCode`, `billingCountryCode`.

## Actual

- (Bug) `billingPostalCode` is not validated; the form accepts submission without it.

## E2E test

```bash
npm run e2e:verification -- --grep "TC-2"
```
```

---

#### TC-3: EU VAT requirement for business ticket

**Title:**

```
TC-3: EU VAT requirement for business ticket
```

**Body:**

```markdown
## Steps

1. Open the form.
2. Fill in required fields (full name, email, dates).
3. Select `Ticket type = Business`.
4. Fill in `Company name`.
5. Set `Country code` to `ES` (an EU country).
6. Leave `VAT number` empty.
7. Submit.

## Expected

- Validation error: "VAT number is required for EU business registrations."

## Actual

- (Bug) No VAT validation error; the form accepts submission.

## E2E test

```bash
npm run e2e:verification -- --grep "TC-3"
```
```

---

#### TC-4: Discount code price calculation

**Title:**

```
TC-4: Discount code price calculation
```

**Body:**

```markdown
## Steps

1. Open the form.
2. Fill in required fields (full name, email, dates).
3. Select `Ticket type = Standard` (base price: 19900 cents).
4. Enter discount code `SAVE10`.
5. Submit.

## Expected

- Final price is 10% lower: `17910` cents.

## Actual

- (Bug) Final price is `21890` cents (10% higher instead of lower).

## E2E test

```bash
npm run e2e:verification -- --grep "TC-4"
```
```

---

### Step 3: Create bug report issues

Create **4 bug report issues** using the repo's **Bug report (autofix-ready)** template. Link to the user story and test case issues you created.

**Important:** After creating each bug report, add the `autofix` label to trigger the action.

---

#### Bug-1: End date validation accepts invalid ranges

Use the bug report template. Fill in:

- **User story issue (reference):** `https://github.com/<org>/<repo>/issues/<US-1-number>`
- **Test case issue (reference):** `https://github.com/<org>/<repo>/issues/<TC-1-number>`
- **Automated test that fails (if exists):**

```
Command: npm run e2e:verification --prefix examples/nextjs-form-demo -- --grep "TC-1"

Test: e2e/verification.spec.ts - "TC-1: invalid date range shows endDate error"

Failure output:
Error: expect(locator).toBeVisible()
Locator: getByTestId('error-endDate')
Expected: visible
```

- **Title:** `Demo form accepts end date before start date`

---

#### Bug-2: Billing postal code is not required when invoice is enabled

Use the bug report template. Fill in:

- **User story issue (reference):** `https://github.com/<org>/<repo>/issues/<US-1-number>`
- **Test case issue (reference):** `https://github.com/<org>/<repo>/issues/<TC-2-number>`
- **Automated test that fails (if exists):**

```
Command: npm run e2e:verification --prefix examples/nextjs-form-demo -- --grep "TC-2"

Test: e2e/verification.spec.ts - "TC-2: when needsInvoice=true, billingPostalCode is required"

Failure output:
Error: expect(locator).toBeVisible()
Locator: getByTestId('error-billingPostalCode')
Expected: visible
```

- **Title:** `Demo form does not validate billing postal code`

---

#### Bug-3: EU business VAT requirement not enforced

Use the bug report template. Fill in:

- **User story issue (reference):** `https://github.com/<org>/<repo>/issues/<US-1-number>`
- **Test case issue (reference):** `https://github.com/<org>/<repo>/issues/<TC-3-number>`
- **Automated test that fails (if exists):**

```
Command: npm run e2e:verification --prefix examples/nextjs-form-demo -- --grep "TC-3"

Test: e2e/verification.spec.ts - "TC-3: business + EU country requires VAT"

Failure output:
Error: expect(locator).toBeVisible()
Locator: getByTestId('error-vatNumber')
Expected: visible
```

- **Title:** `Business ticket should require VAT for EU countries`

---

#### Bug-4: Discount code SAVE10 price calculation is wrong

Use the bug report template. Fill in:

- **User story issue (reference):** `https://github.com/<org>/<repo>/issues/<US-1-number>`
- **Test case issue (reference):** `https://github.com/<org>/<repo>/issues/<TC-4-number>`
- **Automated test that fails (if exists):**

```
Command: npm run e2e:verification --prefix examples/nextjs-form-demo -- --grep "TC-4"

Test: e2e/verification.spec.ts - "TC-4: SAVE10 applies 10% discount to standard ticket"

Failure output:
Error: expect(locator).toContainText('17910')
Locator: getByTestId('result-final-price')
Received: "Final price: 21890 cents"
```

- **Title:** `Discount code SAVE10 calculates wrong final price`

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
