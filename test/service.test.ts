import { describe, expect, it, vi } from "vitest";

import { CanvasClient } from "../src/canvas/client.js";
import { CanvasService } from "../src/canvas/service.js";

describe("CanvasService module items", () => {
  it("감사에서 확인된 모듈 항목만 정규화하고 외부 URL은 노출하지 않는다", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify([
      {
        id: 20,
        module_id: 10,
        position: 2,
        title: "테스트 학습자료",
        type: "ExternalTool",
        html_url: "https://learning.example.edu/courses/1/modules/items/20",
        external_url: "https://learning.example.edu/lti/launch?token=do-not-expose",
      },
      {
        id: 21,
        module_id: 10,
        position: 1,
        title: "테스트 과제",
        type: "Assignment",
        content_id: 30,
        html_url: "https://learning.example.edu/courses/1/assignments/30",
      },
    ]), { status: 200, headers: { "content-type": "application/json" } }));
    const client = new CanvasClient({
      baseUrl: "https://learning.example.edu",
      accessToken: "test-token",
      timeoutMs: 1_000,
      fetchImpl,
    });
    const service = new CanvasService(client, 2);

    const result = await service.listModuleItems("1", "10");

    expect(result).toEqual({
      source: "Canvas LMS",
      untrustedContent: true,
      courseId: "1",
      moduleId: "10",
      items: [
        {
          id: "21",
          moduleId: "10",
          position: 1,
          title: "테스트 과제",
          type: "Assignment",
          contentId: "30",
          launchUrl: "https://learning.example.edu/courses/1/assignments/30",
        },
        {
          id: "20",
          moduleId: "10",
          position: 2,
          title: "테스트 학습자료",
          type: "ExternalTool",
          contentId: null,
          launchUrl: "https://learning.example.edu/courses/1/modules/items/20",
        },
      ],
      truncated: false,
    });
    expect(JSON.stringify(result)).not.toContain("do-not-expose");
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: "/api/v1/courses/1/modules/10/items",
      }),
      expect.objectContaining({ method: "GET" }),
    );
  });
});
