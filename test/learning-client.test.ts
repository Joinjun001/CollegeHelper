import { describe, expect, it, vi } from "vitest";

import { LearningResourceClient } from "../src/learning/client.js";

describe("LearningResourceClient", () => {
  it("강의자료 목록을 정규화하고 신뢰되지 않은 원문으로 표시한다", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      courseId: "215024",
      resources: [{
        resourceId: "123",
        title: "자료 1",
        fileName: "note.pdf",
        contentType: "document",
        position: 1,
        published: true,
        cached: false,
      }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const client = new LearningResourceClient("http://worker:3200", 1_000, fetchImpl);

    await expect(client.list("215024")).resolves.toMatchObject({
      source: "HY-ON 강의자료실",
      untrustedContent: true,
      resources: [{ resourceId: "123", cached: false }],
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://worker:3200/courses/215024/resources",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("예상하지 못한 응답 스키마를 거부한다", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ token: "secret" }), { status: 200 }));
    const client = new LearningResourceClient("http://worker:3200", 1_000, fetchImpl);
    await expect(client.list("215024")).rejects.toThrow();
  });
});
