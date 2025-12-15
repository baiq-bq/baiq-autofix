import * as path from "path";

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
  const trimmed = text.trim();
  if (trimmed.startsWith("diff --git") || trimmed.startsWith("---")) return trimmed;

  const idx = trimmed.indexOf("diff --git");
  if (idx >= 0) return trimmed.slice(idx).trim();

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
}
