import { execFile } from "node:child_process";
import { createServer, type ServerResponse } from "node:http";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { chromium, type Browser, type BrowserContext, type Page, type Response } from "playwright";
import { z } from "zod";

import { CanvasClient } from "../src/canvas/client.js";
import { loadConfig } from "../src/config.js";

const execFileAsync = promisify(execFile);
const IdSchema = z.string().regex(/^\d+$/);
const LocatorSchema = z.string().regex(/^(course-resource|module-item):\d+$/);
const CourseResourceSchema = z.object({
  resource_id: z.union([z.string(), z.number()]).transform(String).pipe(IdSchema),
  title: z.string().min(1),
  position: z.number().int().nullable().optional(),
  published: z.boolean().nullable().optional(),
  commons_content: z.object({
    content_type: z.string().nullable().optional(),
    file_name: z.string().nullable().optional(),
  }).passthrough().optional(),
}).passthrough();
const ModuleSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String).pipe(IdSchema),
  name: z.string().min(1),
  position: z.number().int().optional(),
}).passthrough();
const ModuleItemSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String).pipe(IdSchema),
  module_id: z.union([z.string(), z.number()]).transform(String).pipe(IdSchema),
  title: z.string().min(1),
  type: z.string(),
  position: z.number().int().optional(),
}).passthrough();

type Location = "course_resource" | "module_item";
interface ResourceItem {
  resourceLocator: string;
  location: Location;
  resourceId: string | null;
  moduleId: string | null;
  moduleItemId: string | null;
  moduleName: string | null;
  title: string;
  fileName: string | null;
  contentType: string | null;
  position: number | null;
  modulePosition: number | null;
  published: boolean | null;
  pdfAvailable: boolean;
}
interface ModuleCandidate {
  moduleId: string;
  moduleItemId: string;
  moduleName: string;
  title: string;
  position: number | null;
  modulePosition: number | null;
}
interface ResourceSession {
  context: BrowserContext;
  page: Page;
  resource: ResourceItem;
  pdfResponse?: Response;
}
interface CachedText {
  courseId: string;
  resourceLocator: string;
  location: Location;
  resourceId: string | null;
  moduleItemId: string | null;
  title: string;
  text: string;
  cachedAt: string;
}
interface PageImageResult {
  courseId: string;
  resourceLocator: string;
  title: string;
  page: number;
  pageCount: number;
  dpi: number;
  mimeType: "image/png";
  imageData: string;
  byteLength: number;
  cached: boolean;
}

const pageImageCache = new Map<string, { expiresAt: number; value: Omit<PageImageResult, "cached"> }>();
const pageImageCacheTtlMs = 10 * 60_000;
const pageImageCacheMaxEntries = 24;

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
server.listen(port, "0.0.0.0", () => process.stderr.write(`Learning resource worker listening on port ${port}\n`));

async function handleRequest(method: string, rawUrl: string, activeBrowser: Browser): Promise<object> {
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
        cached: await readCachedText(courseId, resource.resourceLocator) !== null,
      }))),
    };
  }
  const pageImageMatch = /^\/courses\/(\d+)\/resources\/page-image$/.exec(url.pathname);
  if (pageImageMatch?.[1]) {
    const courseId = IdSchema.parse(pageImageMatch[1]);
    const locator = LocatorSchema.parse(url.searchParams.get("locator"));
    const page = z.coerce.number().int().min(1).max(10_000).parse(url.searchParams.get("page"));
    const dpi = z.coerce.number().refine((value) => [96, 144, 192].includes(value)).default(144)
      .parse(url.searchParams.get("dpi") ?? undefined);
    return await renderPageImage(activeBrowser, courseId, locator, page, dpi);
  }
  const legacyMatch = /^\/courses\/(\d+)\/resources\/(\d+)\/text$/.exec(url.pathname);
  const locatorMatch = /^\/courses\/(\d+)\/resources\/text$/.exec(url.pathname);
  const courseIdValue = legacyMatch?.[1] ?? locatorMatch?.[1];
  if (!courseIdValue) throw new WorkerError(404);
  const courseId = IdSchema.parse(courseIdValue);
  const locator = legacyMatch?.[2]
    ? `course-resource:${IdSchema.parse(legacyMatch[2])}`
    : LocatorSchema.parse(url.searchParams.get("locator"));
  const offset = z.coerce.number().int().min(0).default(0).parse(url.searchParams.get("offset") ?? undefined);
  const maxChars = z.coerce.number().int().min(1_000).max(20_000).default(12_000).parse(url.searchParams.get("maxChars") ?? undefined);
  const cached = await readCachedText(courseId, locator) ?? await downloadAndExtract(activeBrowser, courseId, locator);
  const text = cached.text.slice(offset, offset + maxChars);
  return {
    courseId,
    resourceLocator: cached.resourceLocator,
    location: cached.location,
    resourceId: cached.resourceId,
    moduleItemId: cached.moduleItemId,
    title: cached.title,
    text,
    offset,
    nextOffset: offset + text.length < cached.text.length ? offset + text.length : null,
    totalChars: cached.text.length,
    cachedAt: cached.cachedAt,
  };
}

async function renderPageImage(
  activeBrowser: Browser,
  courseId: string,
  locator: string,
  page: number,
  dpi: number,
): Promise<PageImageResult> {
  const cacheKey = `${courseId}:${locator}:${page}:${dpi}`;
  const cached = readCachedPageImage(cacheKey);
  if (cached) return { ...cached, cached: true };
  const session = await openResource(activeBrowser, courseId, locator);
  const temporaryDir = await mkdtemp(join(tmpdir(), "college-helper-page-"));
  try {
    const pdfResponse = session.pdfResponse ?? await clickAndWaitForPdf(session);
    const pdfUrl = new URL(pdfResponse.url());
    if (!isAllowedPdf(pdfUrl)) throw new WorkerError(502);
    const download = await session.context.request.get(pdfUrl.toString(), { failOnStatusCode: false, timeout: 60_000 });
    const body = await download.body();
    if (download.status() !== 200
      || !(download.headers()["content-type"] ?? "").toLowerCase().startsWith("application/pdf")
      || body.length === 0 || body.length > 75 * 1024 * 1024
      || body.subarray(0, 5).toString("ascii") !== "%PDF-") throw new WorkerError(502);
    const pdfPath = join(temporaryDir, "source.pdf");
    const imagePrefix = join(temporaryDir, "page");
    const imagePath = `${imagePrefix}.png`;
    await writeFile(pdfPath, body, { mode: 0o600 });
    const { stdout } = await execFileAsync("pdfinfo", [pdfPath], { timeout: 30_000, encoding: "utf8" });
    const pageCount = Number.parseInt(/^Pages:\s+(\d+)$/m.exec(stdout)?.[1] ?? "", 10);
    if (!Number.isSafeInteger(pageCount) || pageCount < 1 || page > pageCount) throw new WorkerError(422);
    await execFileAsync("pdftocairo", [
      "-png", "-singlefile", "-f", String(page), "-l", String(page), "-r", String(dpi), pdfPath, imagePrefix,
    ], { timeout: 60_000 });
    const image = await readFile(imagePath);
    if (image.length === 0 || image.length > 8 * 1024 * 1024) throw new WorkerError(502);
    const value: Omit<PageImageResult, "cached"> = {
      courseId,
      resourceLocator: locator,
      title: session.resource.title,
      page,
      pageCount,
      dpi,
      mimeType: "image/png",
      imageData: image.toString("base64"),
      byteLength: image.length,
    };
    writeCachedPageImage(cacheKey, value);
    return { ...value, cached: false };
  } finally {
    await session.context.close();
    await rm(temporaryDir, { recursive: true, force: true });
  }
}

async function loadResourceList(activeBrowser: Browser, courseId: string): Promise<ResourceItem[]> {
  const courseResources = await loadCourseResources(activeBrowser, courseId).catch((error: unknown) => {
    if (error instanceof WorkerError && error.status === 404) return [];
    throw error;
  });
  const candidates = await loadModuleCandidates(courseId);
  const moduleResources = (await mapConcurrent(candidates, 3, async (candidate) => {
    const session = await openModulePdf(activeBrowser, courseId, candidate, 12_000).catch(() => null);
    if (!session) return null;
    await session.context.close();
    return session.resource;
  })).filter((item): item is ResourceItem => item !== null);
  return [...courseResources, ...moduleResources].sort(compareResources);
}

async function downloadAndExtract(activeBrowser: Browser, courseId: string, locator: string): Promise<CachedText> {
  const session = await openResource(activeBrowser, courseId, locator);
  const temporaryDir = await mkdtemp(join(tmpdir(), "college-helper-"));
  try {
    const pdfResponse = session.pdfResponse ?? await clickAndWaitForPdf(session);
    const pdfUrl = new URL(pdfResponse.url());
    if (!isAllowedPdf(pdfUrl)) throw new WorkerError(502);
    const download = await session.context.request.get(pdfUrl.toString(), { failOnStatusCode: false, timeout: 60_000 });
    const body = await download.body();
    if (download.status() !== 200
      || !(download.headers()["content-type"] ?? "").toLowerCase().startsWith("application/pdf")
      || body.length === 0 || body.length > 75 * 1024 * 1024
      || body.subarray(0, 5).toString("ascii") !== "%PDF-") throw new WorkerError(502);
    const pdfPath = join(temporaryDir, "source.pdf");
    const textPath = join(temporaryDir, "source.txt");
    await writeFile(pdfPath, body, { mode: 0o600 });
    await execFileAsync("pdftotext", ["-layout", "-enc", "UTF-8", pdfPath, textPath], { timeout: 60_000 });
    const text = (await readFile(textPath, "utf8")).replace(/\0/g, "").trim();
    if (!text) throw new WorkerError(422);
    const value: CachedText = {
      courseId,
      resourceLocator: locator,
      location: session.resource.location,
      resourceId: session.resource.resourceId,
      moduleItemId: session.resource.moduleItemId,
      title: session.resource.title,
      text,
      cachedAt: new Date().toISOString(),
    };
    await writeCachedText(value);
    return value;
  } finally {
    await session.context.close();
    await rm(temporaryDir, { recursive: true, force: true });
  }
}

async function openResource(activeBrowser: Browser, courseId: string, locator: string): Promise<ResourceSession> {
  const [kind, id] = LocatorSchema.parse(locator).split(":") as [string, string];
  if (kind === "course-resource") {
    const session = await openCourseResources(activeBrowser, courseId);
    const resource = session.resources.find((item) => item.resourceId === id);
    if (!resource) {
      await session.context.close();
      throw new WorkerError(404);
    }
    return { context: session.context, page: session.page, resource };
  }
  const candidate = (await loadModuleCandidates(courseId)).find((item) => item.moduleItemId === id);
  if (!candidate) throw new WorkerError(404);
  const session = await openModulePdf(activeBrowser, courseId, candidate, 45_000);
  if (!session) throw new WorkerError(404);
  return session;
}

async function loadCourseResources(activeBrowser: Browser, courseId: string): Promise<ResourceItem[]> {
  const session = await openCourseResources(activeBrowser, courseId);
  await session.context.close();
  return session.resources;
}

async function openCourseResources(activeBrowser: Browser, courseId: string): Promise<{
  context: BrowserContext; page: Page; resources: ResourceItem[];
}> {
  const tabs = await client.getAllPages<Record<string, unknown>>(`/api/v1/courses/${encodeURIComponent(courseId)}/tabs`, {}, config.auditMaxPages);
  const tab = tabs.items.find((item) => item["label"] === "강의자료실" && typeof item["id"] === "string");
  const toolId = typeof tab?.["id"] === "string" ? /^context_external_tool_(\d+)$/.exec(tab["id"])?.[1] : undefined;
  if (!toolId) throw new WorkerError(404);
  const launch = await client.getJson<Record<string, unknown>>(
    `/api/v1/courses/${encodeURIComponent(courseId)}/external_tools/sessionless_launch`,
    { id: toolId, launch_type: "course_navigation" },
  );
  const context = await activeBrowser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  try {
    await installReadOnlyRouting(page);
    const responsePromise = page.waitForResponse((response) => {
      try {
        const url = new URL(response.url());
        return url.origin === canvasOrigin() && url.pathname.endsWith("/resources_db") && response.status() === 200;
      } catch { return false; }
    }, { timeout: 30_000 });
    await page.goto(trustedLaunchUrl(launch["url"]).toString(), { waitUntil: "domcontentloaded", timeout: 30_000 });
    const raw = await (await responsePromise).json() as unknown;
    if (!Array.isArray(raw)) throw new WorkerError(502);
    const resources = raw.flatMap((item) => {
      const parsed = CourseResourceSchema.safeParse(item);
      if (!parsed.success) return [];
      return [{
        resourceLocator: `course-resource:${parsed.data.resource_id}`,
        location: "course_resource" as const,
        resourceId: parsed.data.resource_id,
        moduleId: null,
        moduleItemId: null,
        moduleName: null,
        title: parsed.data.title,
        fileName: parsed.data.commons_content?.file_name ?? null,
        contentType: parsed.data.commons_content?.content_type ?? null,
        position: parsed.data.position ?? null,
        modulePosition: null,
        published: parsed.data.published ?? null,
        pdfAvailable: true,
      }];
    }).sort(compareResources);
    return { context, page, resources };
  } catch (error) {
    await context.close();
    throw error;
  }
}

async function loadModuleCandidates(courseId: string): Promise<ModuleCandidate[]> {
  const page = await client.getAllPages<unknown>(`/api/v1/courses/${encodeURIComponent(courseId)}/modules`, {}, config.auditMaxPages);
  const modules = page.items.flatMap((item) => {
    const parsed = ModuleSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
  return (await mapConcurrent(modules, 4, async (module) => {
    const itemsPage = await client.getAllPages<unknown>(
      `/api/v1/courses/${encodeURIComponent(courseId)}/modules/${encodeURIComponent(module.id)}/items`,
      {},
      config.auditMaxPages,
    );
    return itemsPage.items.flatMap((item) => {
      const parsed = ModuleItemSchema.safeParse(item);
      if (!parsed.success || parsed.data.type !== "ExternalTool") return [];
      return [{
        moduleId: parsed.data.module_id,
        moduleItemId: parsed.data.id,
        moduleName: module.name,
        title: parsed.data.title,
        position: parsed.data.position ?? null,
        modulePosition: module.position ?? null,
      }];
    });
  })).flat();
}

async function openModulePdf(
  activeBrowser: Browser,
  courseId: string,
  candidate: ModuleCandidate,
  timeoutMs: number,
): Promise<ResourceSession | null> {
  const launch = await client.getJson<Record<string, unknown>>(
    `/api/v1/courses/${encodeURIComponent(courseId)}/external_tools/sessionless_launch`,
    { launch_type: "module_item", module_item_id: candidate.moduleItemId },
  );
  const context = await activeBrowser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  try {
    await installReadOnlyRouting(page);
    const responsePromise = page.waitForResponse((response) => {
      try {
        return response.request().method() === "GET" && response.status() >= 200 && response.status() < 300
          && isAllowedPdf(new URL(response.url()))
          && (response.headers()["content-type"] ?? "").toLowerCase().startsWith("application/pdf");
      } catch { return false; }
    }, { timeout: timeoutMs }).catch(() => null);
    await page.goto(trustedLaunchUrl(launch["url"]).toString(), { waitUntil: "domcontentloaded", timeout: 30_000 });
    const pdfResponse = await responsePromise;
    if (!pdfResponse) {
      await context.close();
      return null;
    }
    return {
      context,
      page,
      pdfResponse,
      resource: {
        resourceLocator: `module-item:${candidate.moduleItemId}`,
        location: "module_item",
        resourceId: null,
        moduleId: candidate.moduleId,
        moduleItemId: candidate.moduleItemId,
        moduleName: candidate.moduleName,
        title: candidate.title,
        fileName: null,
        contentType: "application/pdf",
        position: candidate.position,
        modulePosition: candidate.modulePosition,
        published: null,
        pdfAvailable: true,
      },
    };
  } catch (error) {
    await context.close();
    throw error;
  }
}

async function clickAndWaitForPdf(session: ResourceSession): Promise<Response> {
  const responsePromise = session.page.waitForResponse((response) => {
    try {
      return response.request().method() === "GET"
        && response.status() >= 200 && response.status() < 300
        && isAllowedPdf(new URL(response.url()));
    }
    catch { return false; }
  }, { timeout: 45_000 });
  await session.page.getByText(session.resource.title, { exact: true }).first().click({ noWaitAfter: true, timeout: 10_000 });
  return responsePromise;
}

async function installReadOnlyRouting(page: Page): Promise<void> {
  let allowedHandshake = false;
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (request.method() === "GET") return route.continue();
    try {
      const url = new URL(request.url());
      if (!allowedHandshake && request.method() === "POST" && request.isNavigationRequest()
        && url.protocol === "https:" && url.origin === canvasOrigin()) {
        allowedHandshake = true;
        return route.continue();
      }
    } catch { /* Invalid request URLs are blocked below. */ }
    return route.abort("blockedbyclient");
  });
}

function canvasOrigin(): string { return new URL(config.canvasBaseUrl).origin; }
function trustedLaunchUrl(value: unknown): URL {
  if (typeof value !== "string") throw new WorkerError(502);
  const url = new URL(value);
  if (url.protocol !== "https:" || url.origin !== canvasOrigin()) throw new WorkerError(502);
  return url;
}
function isAllowedPdf(url: URL): boolean {
  return url.protocol === "https:" && url.hostname === "hycms.hanyang.ac.kr" && url.pathname.endsWith("/original.pdf");
}
function compareResources(left: ResourceItem, right: ResourceItem): number {
  if (left.location !== right.location) return left.location === "course_resource" ? -1 : 1;
  const moduleOrder = (left.modulePosition ?? Number.MAX_SAFE_INTEGER) - (right.modulePosition ?? Number.MAX_SAFE_INTEGER);
  return moduleOrder || (left.position ?? Number.MAX_SAFE_INTEGER) - (right.position ?? Number.MAX_SAFE_INTEGER);
}
function cachePath(courseId: string, locator: string): string {
  const [kind, id] = LocatorSchema.parse(locator).split(":") as [string, string];
  return join(cacheDir, `course-${courseId}`, kind === "course-resource" ? `resource-${id}.json` : `module-item-${id}.json`);
}
function readCachedPageImage(cacheKey: string): Omit<PageImageResult, "cached"> | null {
  const now = Date.now();
  for (const [key, entry] of pageImageCache) {
    if (entry.expiresAt <= now) pageImageCache.delete(key);
  }
  return pageImageCache.get(cacheKey)?.value ?? null;
}
function writeCachedPageImage(cacheKey: string, value: Omit<PageImageResult, "cached">): void {
  pageImageCache.delete(cacheKey);
  pageImageCache.set(cacheKey, { expiresAt: Date.now() + pageImageCacheTtlMs, value });
  while (pageImageCache.size > pageImageCacheMaxEntries) {
    const oldestKey = pageImageCache.keys().next().value;
    if (!oldestKey) break;
    pageImageCache.delete(oldestKey);
  }
}
async function readCachedText(courseId: string, locator: string): Promise<CachedText | null> {
  try {
    const raw = JSON.parse(await readFile(cachePath(courseId, locator), "utf8")) as unknown;
    const current = z.object({
      courseId: IdSchema,
      resourceLocator: LocatorSchema,
      location: z.enum(["course_resource", "module_item"]),
      resourceId: IdSchema.nullable(),
      moduleItemId: IdSchema.nullable(),
      title: z.string(), text: z.string(), cachedAt: z.string().datetime({ offset: true }),
    }).safeParse(raw);
    if (current.success) return current.data;
    const legacy = z.object({
      courseId: IdSchema, resourceId: IdSchema, title: z.string(), text: z.string(), cachedAt: z.string().datetime({ offset: true }),
    }).parse(raw);
    if (locator !== `course-resource:${legacy.resourceId}`) return null;
    return { ...legacy, resourceLocator: locator, location: "course_resource", moduleItemId: null };
  } catch { return null; }
}
async function writeCachedText(value: CachedText): Promise<void> {
  const directory = join(cacheDir, `course-${value.courseId}`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const target = cachePath(value.courseId, value.resourceLocator);
  await writeFile(`${target}.tmp`, JSON.stringify(value), { encoding: "utf8", mode: 0o600 });
  await rename(`${target}.tmp`, target);
}
async function mapConcurrent<T, R>(items: readonly T[], concurrency: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await mapper(items[index] as T);
    }
  }));
  return results;
}
function sendJson(response: ServerResponse, status: number, value: object): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}
class WorkerError extends Error {
  constructor(readonly status: number) { super(`worker status ${status}`); }
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
