import { execFile } from "node:child_process";
import { createServer, type ServerResponse } from "node:http";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { z } from "zod";

import { CanvasClient } from "../src/canvas/client.js";
import { loadConfig } from "../src/config.js";

const execFileAsync = promisify(execFile);
const IdSchema = z.string().regex(/^\d+$/);
const ResourceSchema = z.object({
  resource_id: z.union([z.string(), z.number()]).transform(String).pipe(IdSchema),
  title: z.string().min(1),
  position: z.number().int().nullable().optional(),
  published: z.boolean().nullable().optional(),
  commons_content: z.object({
    content_type: z.string().nullable().optional(),
    file_name: z.string().nullable().optional(),
  }).passthrough(),
}).passthrough();

interface ResourceItem {
  resourceId: string;
  title: string;
  fileName: string | null;
  contentType: string | null;
  position: number | null;
  published: boolean | null;
}

interface CachedText {
  courseId: string;
  resourceId: string;
  title: string;
  text: string;
  cachedAt: string;
}

const config = loadConfig();
const port = Number.parseInt(process.env["LEARNING_RESOURCE_WORKER_PORT"] ?? "3200", 10);
const cacheDir = process.env["LEARNING_RESOURCE_CACHE_DIR"] ?? "/data";
const client = new CanvasClient({
  baseUrl: config.canvasBaseUrl,
  accessToken: config.canvasAccessToken,
  timeoutMs: config.requestTimeoutMs,
});
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
await mkdir(cacheDir, { recursive: true, mode: 0o700 });

const server = createServer((request, response) => {
  void handleRequest(request.method ?? "GET", request.url ?? "/", browser)
    .then((body) => sendJson(response, 200, body))
    .catch((error: unknown) => {
      const status = error instanceof WorkerError ? error.status : 500;
      sendJson(response, status, { error: status === 404 ? "not_found" : "learning_resource_unavailable" });
    });
});

server.listen(port, "0.0.0.0", () => {
  process.stderr.write(`Learning resource worker listening on port ${port}\n`);
});

async function handleRequest(method: string, rawUrl: string, activeBrowser: Browser): Promise<Record<string, unknown>> {
  if (method !== "GET") throw new WorkerError(405);
  const url = new URL(rawUrl, "http://localhost");
  if (url.pathname === "/healthz") return { status: "ok" };
  const listMatch = /^\/courses\/(\d+)\/resources$/.exec(url.pathname);
  if (listMatch?.[1]) {
    const courseId = IdSchema.parse(listMatch[1]);
    const resources = await loadResourceList(activeBrowser, courseId);
    return {
      courseId,
      resources: await Promise.all(resources.map(async (resource) => ({
        ...resource,
        cached: await readCachedText(courseId, resource.resourceId) !== null,
      }))),
    };
  }
  const textMatch = /^\/courses\/(\d+)\/resources\/(\d+)\/text$/.exec(url.pathname);
  if (textMatch?.[1] && textMatch[2]) {
    const courseId = IdSchema.parse(textMatch[1]);
    const resourceId = IdSchema.parse(textMatch[2]);
    const offset = z.coerce.number().int().min(0).default(0).parse(url.searchParams.get("offset") ?? undefined);
    const maxChars = z.coerce.number().int().min(1_000).max(20_000).default(12_000).parse(url.searchParams.get("maxChars") ?? undefined);
    const cached = await readCachedText(courseId, resourceId) ?? await downloadAndExtract(activeBrowser, courseId, resourceId);
    const text = cached.text.slice(offset, offset + maxChars);
    const nextOffset = offset + text.length < cached.text.length ? offset + text.length : null;
    return {
      courseId,
      resourceId,
      title: cached.title,
      text,
      offset,
      nextOffset,
      totalChars: cached.text.length,
      cachedAt: cached.cachedAt,
    };
  }
  throw new WorkerError(404);
}

async function loadResourceList(activeBrowser: Browser, courseId: string): Promise<ResourceItem[]> {
  const session = await openCourseResources(activeBrowser, courseId);
  try {
    return session.resources;
  } finally {
    await session.context.close();
  }
}

async function downloadAndExtract(activeBrowser: Browser, courseId: string, resourceId: string): Promise<CachedText> {
  const session = await openCourseResources(activeBrowser, courseId);
  const resource = session.resources.find((item) => item.resourceId === resourceId);
  if (!resource) {
    await session.context.close();
    throw new WorkerError(404);
  }
  const temporaryDir = await mkdtemp(join(tmpdir(), "college-helper-"));
  try {
    await session.page.route("**/*", async (route) => {
      if (route.request().method() === "GET") await route.continue();
      else await route.abort("blockedbyclient");
    });
    const pdfRequestPromise = session.page.waitForRequest((request) => {
      try {
        const url = new URL(request.url());
        return request.method() === "GET"
          && url.protocol === "https:"
          && url.hostname === "hycms.hanyang.ac.kr"
          && url.pathname.endsWith("/original.pdf");
      } catch {
        return false;
      }
    }, { timeout: 45_000 });
    await session.page.getByText(resource.title, { exact: true }).first().click({ noWaitAfter: true, timeout: 10_000 });
    const pdfRequest = await pdfRequestPromise;
    const pdfUrl = new URL(pdfRequest.url());
    if (pdfUrl.hostname !== "hycms.hanyang.ac.kr" || !pdfUrl.pathname.endsWith("/original.pdf")) throw new WorkerError(502);
    const pdfResponse = await session.context.request.get(pdfUrl.toString(), { failOnStatusCode: false, timeout: 60_000 });
    if (pdfResponse.status() !== 200 || !(pdfResponse.headers()["content-type"] ?? "").toLowerCase().startsWith("application/pdf")) {
      throw new WorkerError(502);
    }
    const body = await pdfResponse.body();
    if (body.length === 0 || body.length > 75 * 1024 * 1024) throw new WorkerError(502);
    const pdfPath = join(temporaryDir, "source.pdf");
    const textPath = join(temporaryDir, "source.txt");
    await writeFile(pdfPath, body, { mode: 0o600 });
    await execFileAsync("pdftotext", ["-layout", "-enc", "UTF-8", pdfPath, textPath], { timeout: 60_000 });
    const text = (await readFile(textPath, "utf8")).replace(/\0/g, "").trim();
    if (!text) throw new WorkerError(422);
    const value: CachedText = { courseId, resourceId, title: resource.title, text, cachedAt: new Date().toISOString() };
    await writeCachedText(value);
    return value;
  } finally {
    await session.context.close();
    await rm(temporaryDir, { recursive: true, force: true });
  }
}

async function openCourseResources(activeBrowser: Browser, courseId: string): Promise<{
  context: BrowserContext;
  page: Page;
  resources: ResourceItem[];
}> {
  const tabs = await client.getAllPages<Record<string, unknown>>(
    `/api/v1/courses/${encodeURIComponent(courseId)}/tabs`,
    {},
    config.auditMaxPages,
  );
  const tab = tabs.items.find((item) => item["label"] === "강의자료실" && typeof item["id"] === "string");
  const toolId = typeof tab?.["id"] === "string" ? /^context_external_tool_(\d+)$/.exec(tab["id"])?.[1] : undefined;
  if (!toolId) throw new WorkerError(404);
  const launch = await client.getJson<Record<string, unknown>>(
    `/api/v1/courses/${encodeURIComponent(courseId)}/external_tools/sessionless_launch`,
    { id: toolId, launch_type: "course_navigation" },
  );
  if (typeof launch["url"] !== "string") throw new WorkerError(502);
  const launchUrl = new URL(launch["url"]);
  const canvasOrigin = new URL(config.canvasBaseUrl).origin;
  if (launchUrl.protocol !== "https:" || launchUrl.origin !== canvasOrigin) throw new WorkerError(502);

  const context = await activeBrowser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  try {
    const responsePromise = page.waitForResponse((response) => {
      try {
        const url = new URL(response.url());
        return url.origin === canvasOrigin && url.pathname.endsWith("/resources_db") && response.status() === 200;
      } catch {
        return false;
      }
    }, { timeout: 30_000 });
    await page.goto(launchUrl.toString(), { waitUntil: "domcontentloaded", timeout: 30_000 });
    const response = await responsePromise;
    const raw = await response.json() as unknown;
    if (!Array.isArray(raw)) throw new WorkerError(502);
    const resources = raw.flatMap((item) => {
      const parsed = ResourceSchema.safeParse(item);
      if (!parsed.success) return [];
      return [{
        resourceId: parsed.data.resource_id,
        title: parsed.data.title,
        fileName: parsed.data.commons_content.file_name ?? null,
        contentType: parsed.data.commons_content.content_type ?? null,
        position: parsed.data.position ?? null,
        published: parsed.data.published ?? null,
      }];
    });
    resources.sort((left, right) => (left.position ?? Number.MAX_SAFE_INTEGER) - (right.position ?? Number.MAX_SAFE_INTEGER));
    return { context, page, resources };
  } catch (error) {
    await context.close();
    throw error;
  }
}

function cachePath(courseId: string, resourceId: string): string {
  return join(cacheDir, `course-${courseId}`, `resource-${resourceId}.json`);
}

async function readCachedText(courseId: string, resourceId: string): Promise<CachedText | null> {
  try {
    const value = JSON.parse(await readFile(cachePath(courseId, resourceId), "utf8")) as unknown;
    return z.object({
      courseId: IdSchema,
      resourceId: IdSchema,
      title: z.string(),
      text: z.string(),
      cachedAt: z.string().datetime({ offset: true }),
    }).parse(value);
  } catch {
    return null;
  }
}

async function writeCachedText(value: CachedText): Promise<void> {
  const directory = join(cacheDir, `course-${value.courseId}`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const target = cachePath(value.courseId, value.resourceId);
  const temporary = `${target}.tmp`;
  await writeFile(temporary, JSON.stringify(value), { encoding: "utf8", mode: 0o600 });
  await rename(temporary, target);
}

function sendJson(response: ServerResponse, status: number, value: Record<string, unknown>): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}

class WorkerError extends Error {
  constructor(readonly status: number) {
    super(`worker status ${status}`);
  }
}

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await browser.close();
}
process.once("SIGINT", () => { void shutdown().finally(() => process.exit(0)); });
process.once("SIGTERM", () => { void shutdown().finally(() => process.exit(0)); });
