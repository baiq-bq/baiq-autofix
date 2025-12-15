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
