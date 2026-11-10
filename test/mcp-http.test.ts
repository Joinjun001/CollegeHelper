import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, type McpServer } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CanvasClient } from "../src/canvas/client.js";
import { CanvasService } from "../src/canvas/service.js";
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
      { id: 215024, name: "테스트 과목", course_code: "TEST101", workflow_state: "available" },
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
      courses: [{ id: "215024", name: "테스트 과목" }],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
