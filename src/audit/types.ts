export type AuditStatus =
  | "supported"
  | "empty"
  | "forbidden"
  | "unauthorized"
  | "not_found"
  | "error";

export interface AuditResult {
  id: string;
  name: string;
  method: "GET";
  path: string;
  status: AuditStatus;
  httpStatus?: number;
  itemCount: number;
  pagination: boolean;
  fields: string[];
  containsSensitiveData: boolean;
  notes: string[];
}

export interface AuditReport {
  schemaVersion: 1;
  generatedAt: string;
  readOnly: true;
  summary: Record<AuditStatus, number>;
  results: AuditResult[];
}
