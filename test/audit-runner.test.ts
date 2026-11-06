import { describe, expect, it, vi } from "vitest";
import type { CanvasClient } from "../src/canvas/client.js";
import { createAuditReport } from "../src/audit/report.js";
import { runCanvasAudit } from "../src/audit/runner.js";

describe("Canvas API 감사", () => {
  it("실제 응답값과 Canvas ID를 보고서에 남기지 않는다", async () => {
    const client = {
      getJson: vi.fn((path: string) => {
        if (path === "/api/v1/users/self/profile") {
          return Promise.resolve({ id: "private-user-id", name: "홍길동", email: "private@example.edu" });
        }
        return Promise.resolve({ id: "private-course-id", name: "비공개 과목명" });
      }),
      getAllPages: vi.fn((path: string) => Promise.resolve({
        items: path === "/api/v1/courses" ? [{ id: "private-course-id", name: "비공개 과목명" }] : [],
        pageCount: 1,
        hadLinkHeader: false,
        truncated: false,
      })),
    } as unknown as CanvasClient;

    const results = await runCanvasAudit(client, { maxPages: 2, maxCourses: 1 });
    const serialized = JSON.stringify(createAuditReport(results));

    expect(serialized).not.toContain("private-user-id");
    expect(serialized).not.toContain("private-course-id");
    expect(serialized).not.toContain("private@example.edu");
    expect(serialized).not.toContain("비공개 과목명");
    expect(results.find((result) => result.id === "A01")?.fields).toContain("email");
    expect(results.find((result) => result.id === "A05")?.httpStatus).toBeUndefined();
  });
});
