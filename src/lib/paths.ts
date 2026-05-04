import { realpath } from "node:fs/promises";
import path from "node:path";

export function expandTilde(input: string, home = process.env.HOME ?? ""): string {
  if (input === "~" || input.startsWith("~/")) {
    return path.join(home, input.slice(1).replace(/^\//, ""));
  }
  return input;
}

export function normalizeRoot(p: string): string {
  return path.resolve(expandTilde(p.trim()));
}

/**
 * Ensures candidate (after realpath) stays under root (after realpath).
 */
export async function assertUnderProjectRoot(
  projectRoot: string,
  candidateAbsolute: string
): Promise<{ ok: true; root: string; candidate: string } | { ok: false; reason: string }> {
  const rootResolved = path.resolve(normalizeRoot(projectRoot));
  let rootReal = rootResolved;
  let candidateReal = path.resolve(candidateAbsolute);
  try {
    rootReal = await realpath(rootResolved);
  } catch {
    // root may not exist yet; use resolved
  }
  try {
    candidateReal = await realpath(candidateAbsolute);
  } catch {
    candidateReal = path.resolve(candidateAbsolute);
  }
  const prefix = rootReal.endsWith(path.sep) ? rootReal : rootReal + path.sep;
  const same = candidateReal === rootReal;
  const under = candidateReal.startsWith(prefix);
  if (!same && !under) {
    return {
      ok: false,
      reason: `Refusing path outside project root: ${candidateReal}`,
    };
  }
  return { ok: true, root: rootReal, candidate: candidateReal };
}
