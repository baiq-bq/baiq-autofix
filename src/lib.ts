import * as path from "path";

export type GitHubIssueRef = {
  owner: string;
  repo: string;
  number: number;
  url: string;
};

export function truncate(s: string, maxChars: number): string {
  if (s.length <= maxChars) return s;
  return `${s.slice(0, maxChars)}\n[TRUNCATED: ${s.length - maxChars} chars]`;
}

export function safeRepoRelativePath(repoRoot: string, filePath: string): string {
  if (path.isAbsolute(filePath)) {
    throw new Error(`Absolute paths are not allowed: ${filePath}`);
  }

  const normalized = filePath.replace(/\\/g, "/");
  if (normalized.includes("..")) {
    throw new Error(`Path traversal is not allowed: ${filePath}`);
  }

  const resolved = path.resolve(repoRoot, normalized);
  if (!resolved.startsWith(repoRoot + path.sep) && resolved !== repoRoot) {
    throw new Error(`Path escapes repository: ${filePath}`);
  }

  return resolved;
}

export function countLines(s: string): number {
  if (!s) return 0;
  return s.split(/\r?\n/).length;
}

export function extractDiffOnly(text: string): string {
  let trimmed = text.trim();

  // Strip markdown code fences if present (```diff ... ``` or ``` ... ```)
  const fenceMatch = trimmed.match(/^```(?:diff)?\s*\n([\s\S]*?)\n```\s*$/);
  if (fenceMatch) {
    trimmed = fenceMatch[1].trim();
  }

  // Also handle case where fence is at start but content continues after
  if (trimmed.startsWith("```")) {
    const endFence = trimmed.indexOf("```", 3);
    if (endFence > 0) {
      const firstNewline = trimmed.indexOf("\n");
      if (firstNewline > 0 && firstNewline < endFence) {
        trimmed = trimmed.slice(firstNewline + 1, endFence).trim();
      }
    }
  }

  if (trimmed.startsWith("diff --git") || trimmed.startsWith("---")) return trimmed;

  const idx = trimmed.indexOf("diff --git");
  if (idx >= 0) return trimmed.slice(idx).trim();

  // Also try finding --- a/ pattern for diffs without the git header
  const dashIdx = trimmed.indexOf("--- a/");
  if (dashIdx >= 0) return trimmed.slice(dashIdx).trim();

  throw new Error("Model did not return a unified diff.");
}

export function validateDiff(diff: string): void {
  const forbiddenPathPatterns = [
    /(^|\n)diff --git a\/package-lock\.json b\/package-lock\.json\n/,
    /(^|\n)diff --git a\/pnpm-lock\.yaml b\/pnpm-lock\.yaml\n/,
    /(^|\n)diff --git a\/yarn\.lock b\/yarn\.lock\n/,
    /(^|\n)diff --git a\/\.github\/workflows\//,
  ];

  for (const re of forbiddenPathPatterns) {
    if (re.test(diff)) {
      throw new Error("Generated diff touches a forbidden file (lockfiles or .github/workflows). Refusing to apply.");
    }
  }

  if (/^GIT binary patch/m.test(diff)) {
    throw new Error("Binary patches are not supported.");
  }

  // Validate hunk headers have proper line numbers (e.g., @@ -1,3 +1,3 @@)
  // A valid hunk header must have at least @@ -N +N @@ or @@ -N,M +N,M @@
  const hunkHeaderPattern = /^@@\s+-\d+(,\d+)?\s+\+\d+(,\d+)?\s+@@/;
  const malformedHunkPattern = /^@@\s*$/m;

  if (malformedHunkPattern.test(diff)) {
    throw new Error(
      "Generated diff has malformed hunk headers (missing line numbers). " +
        "Expected format: @@ -start,count +start,count @@"
    );
  }

  // Check that at least one valid hunk header exists
  const lines = diff.split("\n");
  const hasHunkHeader = lines.some((line) => line.startsWith("@@"));
  if (hasHunkHeader) {
    const allHunksValid = lines
      .filter((line) => line.startsWith("@@"))
      .every((line) => hunkHeaderPattern.test(line));

    if (!allHunksValid) {
      throw new Error(
        "Generated diff has malformed hunk headers (missing line numbers). " +
          "Expected format: @@ -start,count +start,count @@"
      );
    }
  }
}

export function extractIssueFormFieldValue(issueBody: string, label: string): string | undefined {
  if (!issueBody.trim()) return undefined;

  const lines = issueBody.split(/\r?\n/);
  const headingRe = new RegExp(`^#{1,6}\\s*${escapeRegExp(label)}\\s*$`, "i");

  for (let i = 0; i < lines.length; i++) {
    if (!headingRe.test(lines[i].trim())) continue;

    const out: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j];
      if (/^#{1,6}\s+/.test(line)) break;
      out.push(line);
    }

    const val = out
      .join("\n")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .join("\n")
      .trim();

    return val || undefined;
  }

  return undefined;
}

export function parseGitHubIssueRef(params: {
  input: string;
  defaultOwner?: string;
  defaultRepo?: string;
}): GitHubIssueRef | undefined {
  const raw = params.input.trim();
  if (!raw) return undefined;

  const hashMatch = raw.match(/^#(\d+)$/);
  if (hashMatch) {
    const number = Number(hashMatch[1]);
    if (!Number.isFinite(number) || number <= 0) return undefined;
    if (!params.defaultOwner || !params.defaultRepo) return undefined;
    return {
      owner: params.defaultOwner,
      repo: params.defaultRepo,
      number,
      url: `https://github.com/${params.defaultOwner}/${params.defaultRepo}/issues/${number}`,
    };
  }

  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return undefined;
  }

  if (u.hostname !== "github.com") return undefined;
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts.length < 4) return undefined;

  const [owner, repo, kind, numStr] = parts;
  if (!owner || !repo) return undefined;
  if (kind !== "issues" && kind !== "pull") return undefined;

  const number = Number(numStr);
  if (!Number.isFinite(number) || number <= 0) return undefined;

  return { owner, repo, number, url: u.toString() };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
