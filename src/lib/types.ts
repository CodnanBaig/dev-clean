import type { CleanableDirName } from "./constants.js";

export type SortKey = "size" | "name";

export interface ProjectTarget {
  name: CleanableDirName | "log_files";
  /** Display or primary path; for directories, the folder to remove */
  absolutePath: string;
  bytes: number;
  /** When name is log_files, concrete files to unlink (project root only) */
  logFilePaths?: string[];
}

export interface DiscoveredProject {
  root: string;
  packageJsonPath: string;
  /** mtime ms of package.json */
  lastModifiedMs: number;
  /** Optional signals for detection */
  signals: {
    hasNextConfig: boolean;
    hasNodeModules: boolean;
  };
}

export interface MeasuredProject extends DiscoveredProject {
  targets: ProjectTarget[];
  totalReclaimableBytes: number;
}

export interface CleanResult {
  path: string;
  bytesBefore: number;
  dryRun: boolean;
  deleted: boolean;
  error?: string;
}
