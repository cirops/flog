export type PeriodName = "morning" | "afternoon";

export type Activity = {
  id: string;
  description: string;
  createdAt: string;
};

export type WorkPeriod = {
  start: string;
  end: string;
  activities: Activity[];
  notes?: string;
};

export type DayWorklog = {
  schemaVersion: 1;
  date: string;
  morning: WorkPeriod;
  afternoon: WorkPeriod;
};

export type DestinationName = "tempo";

export type TempoBillableMode = "equal" | "none";

export type TempoConfig = {
  apiUrl: string;
  issueId?: number;
  issueKey?: string;
  authorAccountId?: string;
  descriptionFormat: string;
  billableMode: TempoBillableMode;
  attributes?: unknown;
};

export type FlogConfig = {
  dataDir?: string;
  destination: DestinationName;
  defaults: {
    morningStart: string;
    morningEnd: string;
    afternoonStart: string;
    afternoonEnd: string;
    dailyTargetHours: number;
  };
  tempo: TempoConfig;
};

export type SubmissionStatus = "submitted" | "failed";

export type SubmissionRecord = {
  schemaVersion: 1;
  key: string;
  destination: DestinationName;
  date: string;
  period: PeriodName;
  status: SubmissionStatus;
  submittedAt: string;
  externalId?: string;
  payloadHash: string;
  error?: string;
};

export type WorklogPayload = {
  key: string;
  destination: DestinationName;
  date: string;
  period: PeriodName;
  summary: string;
  endpoint: string;
  body: Record<string, unknown>;
};
