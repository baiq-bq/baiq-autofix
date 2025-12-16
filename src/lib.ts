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

export function stripIssueSections(issueBody: string, labels: string[]): string {
  if (!issueBody.trim()) return issueBody;

  const lines = issueBody.split(/\r?\n/);
  const headingRegexes = labels.map((label) => new RegExp(`^#{1,6}\\s*${escapeRegExp(label)}\\s*$`, "i"));

  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    const isHeading = /^#{1,6}\s+/.test(trimmed);
    const matchesTargetHeading = headingRegexes.some((re) => re.test(trimmed));

    if (isHeading && matchesTargetHeading) {
      // Skip lines until the next heading (or end of file)
      while (i + 1 < lines.length) {
        const nextLine = lines[i + 1];
        if (/^#{1,6}\s+/.test(nextLine.trim())) {
          break;
        }
        i++;
      }
      continue;
    }

    out.push(line);
  }

  return out.join("\n").trimEnd();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
