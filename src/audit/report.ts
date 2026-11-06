import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AuditReport, AuditResult, AuditStatus } from "./types.js";

const STATUS_ORDER: AuditStatus[] = ["supported", "empty", "forbidden", "unauthorized", "not_found", "error"];

export function createAuditReport(results: AuditResult[], generatedAt = new Date()): AuditReport {
  const summary = Object.fromEntries(STATUS_ORDER.map((status) => [status, 0])) as Record<AuditStatus, number>;
  for (const result of results) summary[result.status] += 1;
  return {
    schemaVersion: 1,
    generatedAt: generatedAt.toISOString(),
    readOnly: true,
    summary,
    results,
  };
}

export function renderMarkdown(report: AuditReport): string {
  const summary = STATUS_ORDER.map((status) => `- ${status}: ${report.summary[status]}`).join("\n");
  const rows = report.results.map((result) => {
    const fields = result.fields.length > 0 ? result.fields.map((field) => `\`${field}\``).join(", ") : "-";
    const notes = result.notes.length > 0 ? result.notes.join("; ").replaceAll("|", "\\|") : "-";
    return `| ${result.id} | ${result.name} | ${result.status} | ${result.httpStatus ?? "-"} | ${result.itemCount} | ${result.pagination ? "yes" : "no"} | ${result.containsSensitiveData ? "yes" : "no"} | ${fields} | ${notes} |`;
  });

  return [
    "# Canvas API 감사 보고서",
    "",
    `생성 시각: ${report.generatedAt}`,
    "",
    "> 이 보고서는 응답값, 토큰, 이메일, 학번, 점수, 제출 원문 및 서명된 URL을 저장하지 않습니다.",
    "",
    "## 요약",
    "",
    summary,
    "",
    "## 엔드포인트",
    "",
    "| ID | 데이터 | 상태 | HTTP | 항목 수 | 페이지네이션 | 민감 필드 감지 | 필드명 | 참고 |",
    "|---|---|---|---:|---:|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}

export async function writeAuditReport(report: AuditReport, reportsDir: string): Promise<void> {
  await mkdir(reportsDir, { recursive: true, mode: 0o700 });
  await Promise.all([
    writeFile(path.join(reportsDir, "canvas-api-audit.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 }),
    writeFile(path.join(reportsDir, "canvas-api-audit.md"), renderMarkdown(report), { mode: 0o600 }),
  ]);
}
