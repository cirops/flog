import { createHash } from "node:crypto";
import { mkdir, readFile, appendFile } from "node:fs/promises";
import path from "node:path";
import type { SubmissionRecord, WorklogPayload } from "./types.js";

export function submissionsPath(dataDir: string): string {
  return path.join(dataDir, "submissions.jsonl");
}

export function payloadHash(payload: WorklogPayload): string {
  return createHash("sha256").update(JSON.stringify(payload.body)).digest("hex");
}

export async function readSubmissions(dataDir: string): Promise<SubmissionRecord[]> {
  try {
    const raw = await readFile(submissionsPath(dataDir), "utf8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as SubmissionRecord);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function hasSubmitted(dataDir: string, key: string): Promise<SubmissionRecord | undefined> {
  return (await readSubmissions(dataDir)).find(
    (record) => record.key === key && record.status === "submitted"
  );
}

export async function appendSubmission(dataDir: string, record: SubmissionRecord): Promise<void> {
  await mkdir(path.dirname(submissionsPath(dataDir)), { recursive: true });
  await appendFile(submissionsPath(dataDir), `${JSON.stringify(record)}\n`, "utf8");
}
