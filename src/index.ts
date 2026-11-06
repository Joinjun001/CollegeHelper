import { CanvasClient } from "./canvas/client.js";
import { CanvasService } from "./canvas/service.js";
import { loadConfig } from "./config.js";
import { startHttpServer } from "./http-server.js";

const config = loadConfig();
const client = new CanvasClient({
  baseUrl: config.canvasBaseUrl,
  accessToken: config.canvasAccessToken,
  timeoutMs: config.requestTimeoutMs,
});
const service = new CanvasService(client, config.auditMaxPages);
const running = await startHttpServer(config, service);

process.stderr.write(`CollegeHelper MCP listening on http://${config.mcpHost}:${config.mcpPort}/mcp\n`);

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await running.close();
}

process.once("SIGINT", () => { void shutdown().finally(() => process.exit(0)); });
process.once("SIGTERM", () => { void shutdown().finally(() => process.exit(0)); });
