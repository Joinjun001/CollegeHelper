import { CanvasClient } from "../src/canvas/client.js";
import { ConfigError, loadConfig } from "../src/config.js";
import { createAuditReport, writeAuditReport } from "../src/audit/report.js";
import { runCanvasAudit } from "../src/audit/runner.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const client = new CanvasClient({
    baseUrl: config.canvasBaseUrl,
    accessToken: config.canvasAccessToken,
    timeoutMs: config.requestTimeoutMs,
  });
  const results = await runCanvasAudit(client, {
    maxPages: config.auditMaxPages,
    maxCourses: config.auditMaxCourses,
  });
  const report = createAuditReport(results);
  await writeAuditReport(report, config.reportsDir);
  const supported = report.summary.supported;
  const failed = report.summary.error + report.summary.unauthorized;
  process.stderr.write(`Canvas API 감사 완료: 지원 ${supported}개, 확인 필요 ${failed}개. 보고서: ${config.reportsDir}\n`);
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    process.stderr.write(`${error.message}\n`);
  } else {
    process.stderr.write("Canvas API 감사를 완료하지 못했습니다. 민감정보 보호를 위해 상세 응답은 출력하지 않습니다.\n");
  }
  process.exitCode = 1;
});
