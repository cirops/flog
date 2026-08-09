import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createConfigStore } from "../config.js";
import type { CapturePatternsFile } from "./types.js";

const DEFAULT_PATTERNS = ["git checkout -b", "git switch -c"] as const;

export function defaultCapturePatterns(): string[] {
  return [...DEFAULT_PATTERNS];
}

export function patternsPath(configDir?: string): string {
  const dir = configDir ?? path.dirname(createConfigStore().path);
  return path.join(dir, "capture-patterns.json");
}

export type AddUserPatternResult = {
  path: string;
  pattern: string;
  added: boolean;
  alreadyPresent: boolean;
  needsHookReinstall: boolean;
};

export async function loadCapturePatterns(configDir?: string): Promise<string[]> {
  const userPatterns = await readUserPatterns(configDir);
  return uniqueStrings([...defaultCapturePatterns(), ...userPatterns]);
}

export async function addUserCapturePattern(
  pattern: string,
  configDir?: string
): Promise<AddUserPatternResult> {
  const normalized = normalizeCommand(pattern);
  if (!normalized) {
    throw new Error("Pattern text is required.");
  }

  const file = patternsPath(configDir);
  const before = await loadCapturePatterns(configDir);
  const rootsBefore = new Set(commandRoots(before));
  const userPatterns = await readUserPatterns(configDir);

  if (before.includes(normalized) || userPatterns.includes(normalized)) {
    return {
      path: file,
      pattern: normalized,
      added: false,
      alreadyPresent: true,
      needsHookReinstall: false
    };
  }

  const nextUser = uniqueStrings([...userPatterns, normalized]);
  await writePatternsFile(file, nextUser);

  const after = uniqueStrings([...defaultCapturePatterns(), ...nextUser]);
  const rootsAfter = commandRoots(after);
  const needsHookReinstall = rootsAfter.some((root) => !rootsBefore.has(root));

  return {
    path: file,
    pattern: normalized,
    added: true,
    alreadyPresent: false,
    needsHookReinstall
  };
}

export function matchesPattern(raw: string, patterns: string[]): boolean {
  const normalized = normalizeCommand(raw);
  if (!normalized) {
    return false;
  }
  for (const pattern of patterns) {
    const p = normalizeCommand(pattern);
    if (!p) {
      continue;
    }
    if (normalized === p || normalized.startsWith(`${p} `)) {
      return true;
    }
  }
  return false;
}

export function commandRoots(patterns: string[]): string[] {
  const roots: string[] = [];
  for (const pattern of patterns) {
    const first = normalizeCommand(pattern).split(" ")[0];
    if (first && !roots.includes(first)) {
      roots.push(first);
    }
  }
  return roots;
}

function normalizeCommand(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

async function readUserPatterns(configDir?: string): Promise<string[]> {
  const file = patternsPath(configDir);
  try {
    const raw = await readFile(file, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid JSON in ${file}: ${detail}`);
    }
    return normalizePatternsFile(parsed, file).map((item) => normalizeCommand(item)).filter(Boolean);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function writePatternsFile(file: string, patterns: string[]): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  const body: CapturePatternsFile = { patterns };
  await writeFile(temp, `${JSON.stringify(body, null, 2)}\n`, "utf8");
  await rename(temp, file);
}

function normalizePatternsFile(parsed: unknown, file: string): string[] {
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as CapturePatternsFile).patterns)) {
    throw new Error(`Invalid capture patterns file ${file}: expected { "patterns": string[] }.`);
  }
  return (parsed as CapturePatternsFile).patterns
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    out.push(value);
  }
  return out;
}
