import { describe, expect, it, vi } from "vitest";
import { CanvasClient } from "../src/canvas/client.js";
import type { CanvasError } from "../src/canvas/errors.js";

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify(value), { ...init, headers });
}

describe("CanvasClient", () => {
  it("GET과 Bearer 헤더만 사용하고 페이지를 합친다", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse([{ id: 1 }], { headers: { link: '<https://canvas.example.edu/api/v1/courses?page=2>; rel="next"' } }))
      .mockResolvedValueOnce(jsonResponse([{ id: 2 }]));
    const client = new CanvasClient({ baseUrl: "https://canvas.example.edu", accessToken: "secret", timeoutMs: 1_000, fetchImpl });

    const result = await client.getAllPages<{ id: number }>("/api/v1/courses");

    expect(result.items).toEqual([{ id: 1 }, { id: 2 }]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    for (const call of fetchImpl.mock.calls) {
      expect(call[1]?.method).toBe("GET");
      expect(new Headers(call[1]?.headers).get("authorization")).toBe("Bearer secret");
    }
  });

  it("HTTP 오류 본문을 노출하지 않고 정규화한다", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ token: "leaked" }, { status: 403 }));
    const client = new CanvasClient({ baseUrl: "https://canvas.example.edu", accessToken: "secret", timeoutMs: 1_000, fetchImpl });
    await expect(client.getJson("/api/v1/courses/1")).rejects.toMatchObject<Partial<CanvasError>>({ code: "FORBIDDEN", httpStatus: 403 });
    await expect(client.getJson("/api/v1/courses/1")).rejects.not.toThrow("leaked");
  });

  it("외부 호스트 리다이렉트를 차단한다", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://evil.example/login" } }));
    const client = new CanvasClient({ baseUrl: "https://canvas.example.edu", accessToken: "secret", timeoutMs: 1_000, fetchImpl });
    await expect(client.getJson("/api/v1/courses/1")).rejects.toMatchObject<Partial<CanvasError>>({ code: "INVALID_RESPONSE" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("429 응답의 Retry-After를 지킨 뒤 재시도한다", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({}, { status: 429, headers: { "retry-after": "0" } }))
      .mockResolvedValueOnce(jsonResponse({ id: 1 }));
    const client = new CanvasClient({ baseUrl: "https://canvas.example.edu", accessToken: "secret", timeoutMs: 1_000, fetchImpl });

    await expect(client.getJson("/api/v1/courses/1")).resolves.toEqual({ id: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
