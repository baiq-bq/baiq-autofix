import test from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";

import {
  countLines,
  extractDiffOnly,
  extractIssueFormFieldValue,
  parseGitHubIssueRef,
  safeRepoRelativePath,
  truncate,
  validateDiff,
} from "../src/lib";

test("truncate returns original string when under limit", () => {
  assert.equal(truncate("abc", 10), "abc");
});

test("truncate appends truncation notice when over limit", () => {
  const out = truncate("a".repeat(20), 5);
  assert.ok(out.startsWith("aaaaa"));
  assert.ok(out.includes("TRUNCATED"));
});

test("countLines counts newline separated lines", () => {
  assert.equal(countLines("a\nb\n"), 3);
});

test("safeRepoRelativePath rejects absolute paths", () => {
  assert.throws(() => safeRepoRelativePath("/repo", "/etc/passwd"));
});

test("safeRepoRelativePath rejects path traversal", () => {
  assert.throws(() => safeRepoRelativePath("/repo", "../x"));
});

test("safeRepoRelativePath resolves within repo", () => {
  const root = "/repo";
  const resolved = safeRepoRelativePath(root, "src/index.ts");
  assert.equal(resolved, path.resolve(root, "src/index.ts"));
});

test("extractDiffOnly returns diff when prefixed with chatter", () => {
  const text = "hello\n\ndiff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@\n";
  const diff = extractDiffOnly(text);
  assert.ok(diff.startsWith("diff --git"));
});

test("extractDiffOnly throws when no diff exists", () => {
  assert.throws(() => extractDiffOnly("nope"));
});

test("validateDiff rejects lockfile changes", () => {
  const diff =
    "diff --git a/package-lock.json b/package-lock.json\n--- a/package-lock.json\n+++ b/package-lock.json\n@@\n";
  assert.throws(() => validateDiff(diff));
});

test("validateDiff rejects binary patches", () => {
  const diff = "diff --git a/a.bin b/a.bin\nGIT binary patch\n";
  assert.throws(() => validateDiff(diff));
});

test("validateDiff allows simple text diff", () => {
  const diff = "diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@\n";
  validateDiff(diff);
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
