import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, type McpServer } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CanvasClient } from "../src/canvas/client.js";
import { CanvasService } from "../src/canvas/service.js";
import { LearningResourceClient } from "../src/learning/client.js";
import { createCollegeHelperMcpServer } from "../src/mcp/server.js";

describe("MCP server", () => {
  let server: McpServer | undefined;
  let client: Client | undefined;

  afterEach(async () => {
    await client?.close();
    await server?.close();
  });

  it("lists tools and calls a read-only Canvas tool", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify([
      { id: 999001, name: "테스트 과목", course_code: "TEST101", workflow_state: "available" },
    ]), { status: 200, headers: { "content-type": "application/json" } }));
    const canvas = new CanvasClient({
      baseUrl: "https://learning.example.edu",
      accessToken: "test-token",
      timeoutMs: 1_000,
      fetchImpl,
    });
    const service = new CanvasService(canvas, 2);
    server = createCollegeHelperMcpServer(service);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    client = new Client({ name: "college-helper-test", version: "0.1.0" });
    await client.connect(clientTransport);

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual([
      "list_courses",
      "get_today_tasks",
      "get_upcoming_tasks",
      "get_announcements",
      "get_course_modules",
      "get_course_module_items",
      "get_assignment_context",
    ]);
    expect(tools.tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);

    const result = await client.callTool({ name: "list_courses", arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      source: "Canvas LMS",
      untrustedContent: true,
      courses: [{ id: "999001", name: "테스트 과목" }],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("모듈 항목 locator로 학습자료 원문 도구를 호출한다", async () => {
    const canvasFetch = vi.fn<typeof fetch>();
    const learningFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
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
    }), { status: 200 }));
    const canvas = new CanvasClient({
      baseUrl: "https://learning.example.edu",
      accessToken: "test-token",
      timeoutMs: 1_000,
      fetchImpl: canvasFetch,
    });
    const learning = new LearningResourceClient("http://worker:3200", 1_000, learningFetch);
    server = createCollegeHelperMcpServer(new CanvasService(canvas, 2), learning);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new Client({ name: "college-helper-test", version: "0.1.0" });
    await client.connect(clientTransport);

    const result = await client.callTool({
      name: "get_learning_resource_text",
      arguments: { courseId: "999001", resourceLocator: "module-item:456" },
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ resourceLocator: "module-item:456", moduleItemId: "456" });
    expect(learningFetch).toHaveBeenCalledTimes(1);
  });
});
