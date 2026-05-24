import type { FlogConfig, WorklogPayload } from "../types.js";

export type SubmitResult = {
  externalId?: string;
};

export type Destination = {
  name: "tempo";
  validateConfig(config: FlogConfig): void;
  buildPayloads(dates: string[]): Promise<WorklogPayload[]>;
  submit(payload: WorklogPayload): Promise<SubmitResult>;
};
