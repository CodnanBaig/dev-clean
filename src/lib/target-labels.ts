import type { ProjectTarget } from "./types.js";

export function labelForTargetName(name: ProjectTarget["name"]): string {
  if (name === "log_files") return "Root *.log files";
  return name;
}
