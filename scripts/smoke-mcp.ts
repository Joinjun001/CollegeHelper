import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const endpoint = new URL(process.env.MCP_SMOKE_URL ?? "http://127.0.0.1:3100/mcp");
const client = new Client({ name: "college-helper-smoke-test", version: "0.1.0" });

try {
  await client.connect(new StreamableHTTPClientTransport(endpoint));
  const tools = await client.listTools();
  const coursesResult = await client.callTool({ name: "list_courses", arguments: {} });
  const structuredContent: unknown = coursesResult.structuredContent;
  const courses = isRecord(structuredContent) ? structuredContent["courses"] : undefined;
  process.stdout.write(JSON.stringify({
    endpoint: endpoint.toString(),
    tools: tools.tools.map((tool) => tool.name),
    listCoursesSucceeded: coursesResult.isError !== true,
    courseCount: Array.isArray(courses) ? courses.length : null,
  }, null, 2));
  process.stdout.write("\n");
} finally {
  await client.close();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
