import { createServer, type Server as HttpServer } from "node:http";

import { localhostHostValidation, localhostOriginValidation, toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";

import type { AppConfig } from "./config.js";
import type { CanvasService } from "./canvas/service.js";
import type { LearningResourceClient } from "./learning/client.js";
import { createCollegeHelperMcpServer } from "./mcp/server.js";

export interface RunningServer {
  server: HttpServer;
  close: () => Promise<void>;
}

export async function startHttpServer(config: AppConfig, service: CanvasService, learningResources?: LearningResourceClient): Promise<RunningServer> {
  const mcpHandler = createMcpHandler(() => createCollegeHelperMcpServer(service, learningResources), {
    responseMode: "json",
    maxRequestBodySize: 1_048_576,
    onerror: (error) => process.stderr.write(`[mcp] ${error.message}\n`),
  });
  const nodeMcpHandler = toNodeHandler(mcpHandler);
  const validateHost = localhostHostValidation();
  const validateOrigin = localhostOriginValidation();

  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (request.method === "GET" && path === "/healthz") {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      response.end(JSON.stringify({ status: "ok" }));
      return;
    }
    if (path !== "/mcp") {
      response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: "not_found" }));
      return;
    }
    request.method ??= "GET";
    if (!validateHost(request, response) || !validateOrigin(request, response)) return;
    const mcpRequest = request as Parameters<typeof nodeMcpHandler>[0];
    void nodeMcpHandler(mcpRequest, response).catch((error: unknown) => {
      process.stderr.write(`[http] ${error instanceof Error ? error.message : "unknown error"}\n`);
      if (!response.headersSent) response.writeHead(500, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: "internal_error" }));
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.mcpPort, config.mcpHost, () => {
      server.off("error", reject);
      resolve();
    });
  });

  return {
    server,
    close: async () => {
      await mcpHandler.close();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}
