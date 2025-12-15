import test from "node:test";
import assert from "node:assert/strict";

import { extractIssueFormFieldValue, parseGitHubIssueRef, truncate } from "../src/lib";

test("truncate returns original string when under limit", () => {
  assert.equal(truncate("abc", 10), "abc");
});

test("truncate appends truncation notice when over limit", () => {
  const out = truncate("a".repeat(20), 5);
  assert.ok(out.startsWith("aaaaa"));
  assert.ok(out.includes("TRUNCATED"));
});

test("extractIssueFormFieldValue extracts single-line field", () => {
  const body = [
    "# User story issue (reference)",
    "https://github.com/acme/roadmap/issues/123",
    "",
    "# Test case issue (reference)",
    "https://github.com/acme/app/issues/456",
  ].join("\n");

  assert.equal(
    extractIssueFormFieldValue(body, "User story issue (reference)"),
    "https://github.com/acme/roadmap/issues/123"
  );
  assert.equal(
    extractIssueFormFieldValue(body, "Test case issue (reference)"),
    "https://github.com/acme/app/issues/456"
  );
});

test("extractIssueFormFieldValue returns undefined when not found", () => {
  assert.equal(extractIssueFormFieldValue("# Something\nvalue", "Nope"), undefined);
});

test("parseGitHubIssueRef parses GitHub issue URL", () => {
  const ref = parseGitHubIssueRef({ input: "https://github.com/acme/app/issues/42" });
  assert.deepEqual(ref, {
    owner: "acme",
    repo: "app",
    number: 42,
    url: "https://github.com/acme/app/issues/42",
  });
});

test("parseGitHubIssueRef parses GitHub PR URL", () => {
  const ref = parseGitHubIssueRef({ input: "https://github.com/acme/app/pull/7" });
  assert.deepEqual(ref, {
    owner: "acme",
    repo: "app",
    number: 7,
    url: "https://github.com/acme/app/pull/7",
  });
});

test("parseGitHubIssueRef parses same-repo #123 shorthand", () => {
  const ref = parseGitHubIssueRef({ input: "#123", defaultOwner: "acme", defaultRepo: "app" });
  assert.deepEqual(ref, {
    owner: "acme",
    repo: "app",
    number: 123,
    url: "https://github.com/acme/app/issues/123",
  });
});

test("parseGitHubIssueRef returns undefined for non-github URL", () => {
  assert.equal(parseGitHubIssueRef({ input: "https://example.com/acme/app/issues/1" }), undefined);
});
