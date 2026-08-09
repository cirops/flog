import { readFile } from "node:fs/promises";
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

export async function loadCapturePatterns(configDir?: string): Promise<string[]> {
  const file = patternsPath(configDir);
  let userPatterns: string[] = [];
  try {
    const raw = await readFile(file, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid JSON in ${file}: ${detail}`);
    }
    userPatterns = normalizePatternsFile(parsed, file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return defaultCapturePatterns();
    }
    throw error;
  }

  return uniqueStrings([...defaultCapturePatterns(), ...userPatterns]);
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
