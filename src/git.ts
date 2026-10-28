import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

// ---------------------------------------------------------------------------
// Git context capture — used by send to record the commit a message was
// written against. Best-effort: if anything fails (not a repo, git missing,
// detached HEAD, etc.) we just return null and the message ships without it.
// ---------------------------------------------------------------------------

export interface GitContext {
  sha: string;
  shortSha: string;
  branch: string | null;
  dirty: boolean;
}

/**
 * Walk up from `startDir` looking for a `.git` directory. Returns the repo
 * root, or null if we never find one (e.g. file is outside any repo).
 */
function findRepoRoot(startDir: string): string | null {
  let dir = startDir;
  for (let i = 0; i < 32; i++) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

function runGit(args: string[], cwd: string): string | null {
  try {
    const out = cp.execFileSync('git', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1500
    });
    return out.toString().trim();
  } catch {
    return null;
  }
}

/**
 * Get the git context for a file path. Returns null when not in a repo,
 * git isn't on PATH, or any of the calls fail.
 */
export function getGitContext(filePath: string | undefined): GitContext | null {
  if (!filePath) return null;
  const dir = path.dirname(filePath);
  const root = findRepoRoot(dir);
  if (!root) return null;

  const sha = runGit(['rev-parse', 'HEAD'], root);
  if (!sha) return null;

  const branch = runGit(['rev-parse', '--abbrev-ref', 'HEAD'], root);
  const status = runGit(['status', '--porcelain'], root);

  return {
    sha,
    shortSha: sha.slice(0, 7),
    branch: branch && branch !== 'HEAD' ? branch : null,
    dirty: status !== null && status.length > 0
  };
}
