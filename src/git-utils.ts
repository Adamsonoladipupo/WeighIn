import * as exec from "@actions/exec";

/** Run a command and capture stdout. Throws on non-zero exit. */
export async function capture(
  cmd: string,
  args: string[],
  cwd?: string,
): Promise<string> {
  let out = "";
  await exec.exec(cmd, args, {
    cwd,
    listeners: {
      stdout: (d: Buffer) => {
        out += d.toString();
      },
    },
    silent: true,
  });
  return out.trim();
}

/** Run a command and capture stdout without trimming. Throws on non-zero exit. */
export async function captureRaw(
  cmd: string,
  args: string[],
  cwd?: string,
): Promise<string> {
  let out = "";
  await exec.exec(cmd, args, {
    cwd,
    silent: true,
    listeners: {
      stdout: (d: Buffer) => {
        out += d.toString();
      },
    },
  });
  return out;
}

/** Check if git workspace is clean (no uncommitted changes). */
export async function isWorkspaceClean(dir: string): Promise<boolean> {
  try {
    const status = await capture("git", ["status", "--porcelain"], dir);
    return status.trim() === "";
  } catch {
    return false;
  }
}

/** Get list of modified files in git workspace. */
export async function getModifiedFiles(dir: string): Promise<string[]> {
  try {
    // `git status --porcelain` prefixes every entry with a two-character
    // status column, so the raw output is required: trimming it would shift
    // the column and report every path one character short.
    const status = await captureRaw("git", ["status", "--porcelain"], dir);
    return status
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => {
        const path = line.slice(3).trim();
        // A rename is reported as "<old> -> <new>"; the new path is the file
        // that the workspace currently contains.
        const rename = path.indexOf(" -> ");
        return rename === -1 ? path : path.slice(rename + 4);
      });
  } catch {
    return [];
  }
}

/** Get HEAD SHA in the given directory. */
export async function getHeadSha(dir: string): Promise<string> {
  try {
    return await capture("git", ["rev-parse", "HEAD"], dir);
  } catch {
    return "unknown";
  }
}
