import { describe, expect, it, vi } from "vitest";

import { LearningResourceClient } from "../src/learning/client.js";

describe("LearningResourceClient", () => {
  it("강의자료 목록을 정규화하고 신뢰되지 않은 원문으로 표시한다", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      courseId: "999001",
      resources: [{
        resourceLocator: "course-resource:123",
        location: "course_resource",
        resourceId: "123",
        moduleId: null,
        moduleItemId: null,
        moduleName: null,
        title: "자료 1",
        fileName: "note.pdf",
        contentType: "document",
        position: 1,
        published: true,
        pdfAvailable: true,
        cached: false,
      }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const client = new LearningResourceClient("http://worker:3200", 1_000, fetchImpl);

    await expect(client.list("999001")).resolves.toMatchObject({
      source: "HY-ON 강의자료실 및 주차별 학습 모듈",
      untrustedContent: true,
      resources: [{ resourceLocator: "course-resource:123", resourceId: "123", cached: false }],
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://worker:3200/courses/999001/resources",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("모듈 항목 locator로 원문을 요청하고 식별자 종류를 보존한다", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      courseId: "999001",
      resourceLocator: "module-item:456",
      location: "module_item",
      resourceId: null,
      moduleItemId: "456",
      title: "주차별 PDF",
      text: "합성 테스트 본문",
      offset: 0,
      nextOffset: null,
      totalChars: 9,
      cachedAt: "2026-11-16T00:00:00.000Z",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const client = new LearningResourceClient("http://worker:3200", 1_000, fetchImpl);

    await expect(client.getText("999001", undefined, "module-item:456", 0, 12_000)).resolves.toMatchObject({
      source: "HY-ON 학습자료 원본 PDF",
      resourceLocator: "module-item:456",
      moduleItemId: "456",
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://worker:3200/courses/999001/resources/text?locator=module-item%3A456&offset=0&maxChars=12000",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("기존 resourceId를 course-resource locator로 변환한다", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      courseId: "999001",
      resourceLocator: "course-resource:123",
      location: "course_resource",
      resourceId: "123",
      moduleItemId: null,
      title: "기존 PDF",
      text: "합성 테스트 본문",
      offset: 0,
      nextOffset: null,
      totalChars: 9,
      cachedAt: "2026-11-16T00:00:00.000Z",
    }), { status: 200 }));
    const client = new LearningResourceClient("http://worker:3200", 1_000, fetchImpl);

    await client.getText("999001", "123", undefined, 0, 12_000);

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://worker:3200/courses/999001/resources/text?locator=course-resource%3A123&offset=0&maxChars=12000",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("예상하지 못한 응답 스키마를 거부한다", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ token: "secret" }), { status: 200 }));
    const client = new LearningResourceClient("http://worker:3200", 1_000, fetchImpl);
    await expect(client.list("999001")).rejects.toThrow();
  });
});
