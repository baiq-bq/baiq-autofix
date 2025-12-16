import test from "node:test";
import assert from "node:assert/strict";

// Test shellEscape function behavior (testing the pattern used in index.ts)
function shellEscape(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

test("shellEscape handles simple strings", () => {
  assert.equal(shellEscape("hello"), "'hello'");
});

test("shellEscape handles strings with single quotes", () => {
  assert.equal(shellEscape("it's"), "'it'\\''s'");
});

test("shellEscape handles strings with spaces", () => {
  assert.equal(shellEscape("hello world"), "'hello world'");
});

test("shellEscape handles strings with special chars", () => {
  const escaped = shellEscape("$(whoami)");
  assert.equal(escaped, "'$(whoami)'");
});

test("shellEscape handles branch names with slashes", () => {
  const escaped = shellEscape("qa/issue-123-1234567890");
  assert.equal(escaped, "'qa/issue-123-1234567890'");
});

// Test retry logic pattern
test("exponential backoff calculation", () => {
  const delays = [0, 1, 2].map((attempt) => Math.min(1000 * Math.pow(2, attempt), 10000));
  assert.deepEqual(delays, [1000, 2000, 4000]);
});

test("exponential backoff caps at 10 seconds", () => {
  const delay = Math.min(1000 * Math.pow(2, 5), 10000);
  assert.equal(delay, 10000);
});

// Test retryable error detection pattern
function isRetryableError(message: string): boolean {
  return (
    message.includes("rate_limit") ||
    message.includes("timeout") ||
    message.includes("503") ||
    message.includes("502") ||
    message.includes("500")
  );
}

test("isRetryableError detects rate limit errors", () => {
  assert.equal(isRetryableError("rate_limit_exceeded"), true);
});

test("isRetryableError detects timeout errors", () => {
  assert.equal(isRetryableError("Request timeout"), true);
});

test("isRetryableError detects 5xx errors", () => {
  assert.equal(isRetryableError("HTTP 503 Service Unavailable"), true);
  assert.equal(isRetryableError("HTTP 502 Bad Gateway"), true);
  assert.equal(isRetryableError("HTTP 500 Internal Server Error"), true);
});

test("isRetryableError returns false for non-retryable errors", () => {
  assert.equal(isRetryableError("Invalid API key"), false);
  assert.equal(isRetryableError("Model not found"), false);
});

// Test API key validation pattern (used in runAider)
function isValidApiKey(apiKey: string | undefined | null): boolean {
  return !!apiKey && apiKey.trim() !== "";
}

test("isValidApiKey returns false for empty string", () => {
  assert.equal(isValidApiKey(""), false);
});

test("isValidApiKey returns false for whitespace-only string", () => {
  assert.equal(isValidApiKey("   "), false);
});

test("isValidApiKey returns false for undefined", () => {
  assert.equal(isValidApiKey(undefined), false);
});

test("isValidApiKey returns false for null", () => {
  assert.equal(isValidApiKey(null), false);
});

test("isValidApiKey returns true for valid API key", () => {
  assert.equal(isValidApiKey("sk-test-key-123"), true);
});

test("isValidApiKey returns true for key with leading/trailing spaces", () => {
  // The key itself is valid, trim is just for empty check
  assert.equal(isValidApiKey(" sk-test-key "), true);
});

// Test retry-max input parsing pattern (used in index.ts)
function parseRetryMax(input: string | undefined): number {
  const parsed = parseInt(input || "3", 10);
  return Number.isNaN(parsed) ? 3 : Math.max(1, parsed);
}

test("parseRetryMax returns default 3 when input is empty", () => {
  assert.equal(parseRetryMax(""), 3);
});

test("parseRetryMax returns default 3 when input is undefined", () => {
  assert.equal(parseRetryMax(undefined), 3);
});

test("parseRetryMax returns 1 when input is 0 (minimum is 1)", () => {
  assert.equal(parseRetryMax("0"), 1);
});

test("parseRetryMax returns 1 when input is negative", () => {
  assert.equal(parseRetryMax("-5"), 1);
});

test("parseRetryMax returns correct value for valid inputs", () => {
  assert.equal(parseRetryMax("1"), 1);
  assert.equal(parseRetryMax("3"), 3);
  assert.equal(parseRetryMax("5"), 5);
  assert.equal(parseRetryMax("10"), 10);
});

test("parseRetryMax handles NaN gracefully (returns default)", () => {
  assert.equal(parseRetryMax("invalid"), 3);
});

// Test buildAgentPrompt retry message pattern
function buildRetryMessage(attempt: number, previousFailure: string): string | undefined {
  if (attempt > 0 && previousFailure) {
    return (
      `IMPORTANT: This is retry attempt #${attempt + 1}. The previous fix attempt failed the tests.\n` +
      "PREVIOUS TEST FAILURE OUTPUT:\n" +
      `${previousFailure}\n\n` +
      "Please analyze why the previous fix was incorrect and provide a different solution.\n\n"
    );
  }
  return undefined;
}

test("buildRetryMessage returns undefined for first attempt", () => {
  assert.equal(buildRetryMessage(0, "some failure"), undefined);
});

test("buildRetryMessage returns undefined when no previous failure", () => {
  assert.equal(buildRetryMessage(1, ""), undefined);
});

test("buildRetryMessage includes attempt number and failure output", () => {
  const msg = buildRetryMessage(1, "Test failed: expected X got Y");
  assert.ok(msg?.includes("retry attempt #2"));
  assert.ok(msg?.includes("Test failed: expected X got Y"));
  assert.ok(msg?.includes("PREVIOUS TEST FAILURE OUTPUT"));
});

test("buildRetryMessage increments attempt number correctly", () => {
  const msg1 = buildRetryMessage(1, "failure");
  const msg2 = buildRetryMessage(2, "failure");
  const msg3 = buildRetryMessage(3, "failure");
  assert.ok(msg1?.includes("retry attempt #2"));
  assert.ok(msg2?.includes("retry attempt #3"));
  assert.ok(msg3?.includes("retry attempt #4"));
});

// Test add-description input parsing pattern
function parseAddDescription(input: string | undefined): boolean {
  return input !== "false";
}

test("parseAddDescription returns true by default (empty input)", () => {
  assert.equal(parseAddDescription(""), true);
});

test("parseAddDescription returns true for undefined", () => {
  assert.equal(parseAddDescription(undefined), true);
});

test("parseAddDescription returns true for 'true'", () => {
  assert.equal(parseAddDescription("true"), true);
});

test("parseAddDescription returns false only for 'false'", () => {
  assert.equal(parseAddDescription("false"), false);
});

test("parseAddDescription returns true for any other value", () => {
  assert.equal(parseAddDescription("yes"), true);
  assert.equal(parseAddDescription("1"), true);
  assert.equal(parseAddDescription("FALSE"), true); // case-sensitive
});

// Test PR description prompt structure
function buildDescriptionPromptSections(description: string): string[] {
  const sections = ["Bug Description", "Root Cause", "Solution", "How It Fixes the Bug"];
  return sections.filter((s) => description.includes(s));
}

test("buildDescriptionPromptSections identifies all required sections", () => {
  const mockPrompt = `
1. **Bug Description**: What was the bug?
2. **Root Cause**: What was causing this bug?
3. **Solution**: What changes were made?
4. **How It Fixes the Bug**: Explain how these changes resolve the issue.
`;
  const sections = buildDescriptionPromptSections(mockPrompt);
  assert.equal(sections.length, 4);
  assert.ok(sections.includes("Bug Description"));
  assert.ok(sections.includes("Root Cause"));
  assert.ok(sections.includes("Solution"));
  assert.ok(sections.includes("How It Fixes the Bug"));
});

// Mirror buildAgentPrompt restriction behavior in src/index.ts
function buildPromptRestrictionsForAgent(agentType: "aider" | "codex"): string {
  return (
    "IMPORTANT RESTRICTIONS:\n" +
    (agentType === "aider" ? "" : "- Do NOT run any tests - the CI system will run them\n") +
    "- Do NOT run git commands (no git add, git commit, git push) - the CI system handles all git operations\n" +
    "- ONLY modify the source files needed to fix the bug"
  );
}

test("prompt restrictions omit test prohibition for aider", () => {
  const restrictions = buildPromptRestrictionsForAgent("aider");
  assert.equal(restrictions.includes("Do NOT run any tests"), false);
});

test("prompt restrictions include test prohibition for non-aider agents", () => {
  const restrictions = buildPromptRestrictionsForAgent("codex");
  assert.equal(restrictions.includes("Do NOT run any tests"), true);
});
