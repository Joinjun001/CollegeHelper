import { describe, expect, it } from "vitest";
import { createAuditReport, renderMarkdown } from "../src/audit/report.js";

describe("감사 보고서", () => {
  it("응답값 없이 필드와 상태만 렌더링한다", () => {
    const report = createAuditReport([{
      id: "A01",
      name: "현재 사용자",
      method: "GET",
      path: "/api/v1/users/self/profile",
      status: "supported",
      httpStatus: 200,
      itemCount: 1,
      pagination: false,
      fields: ["id", "name", "email"],
      containsSensitiveData: true,
      notes: [],
    }], new Date("2026-11-06T00:00:00.000Z"));
    const markdown = renderMarkdown(report);
    expect(markdown).toContain("`email`");
    expect(markdown).not.toContain("student@example.edu");
    expect(report.summary.supported).toBe(1);
  });
});
