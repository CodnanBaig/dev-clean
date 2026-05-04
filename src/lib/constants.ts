/** Relative directory names we may measure and delete (whitelist only). */
export const CLEANABLE_DIR_NAMES = [
  "node_modules",
  ".next",
  "dist",
  "build",
  ".turbo",
  "coverage",
  ".nuxt",
  "out",
  "storybook-static",
  ".parcel-cache",
  ".vite",
  "logs",
  ".cache",
] as const;

export type CleanableDirName = (typeof CLEANABLE_DIR_NAMES)[number];

export const DEFAULT_SCAN_ROOT_TILDE = [
  "~/Documents",
  "~/Desktop",
  "~/Projects",
  "~/Code",
  "~/Development",
] as const;

/** Values accepted by `--targets` and artifact-type prompts */
export const CLEAN_TARGET_IDS = [...CLEANABLE_DIR_NAMES, "log_files"] as const;
export type CleanTargetId = (typeof CLEAN_TARGET_IDS)[number];

export function isCleanTargetId(id: string): id is CleanTargetId {
  return (CLEAN_TARGET_IDS as readonly string[]).includes(id);
}

export const PACKAGE_JSON = "package.json";
