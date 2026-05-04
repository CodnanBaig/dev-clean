import type { MeasuredProject } from "./types.js";

export function filterProjectsByRecency(
  projects: MeasuredProject[],
  skipRecentDays: number
): MeasuredProject[] {
  if (!skipRecentDays || skipRecentDays <= 0) return projects;
  const cutoff = Date.now() - skipRecentDays * 86_400_000;
  return projects.filter((p) => p.lastModifiedMs < cutoff);
}
