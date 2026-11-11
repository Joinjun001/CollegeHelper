import { chromium, type Request, type Response } from "playwright";

import { CanvasClient } from "../src/canvas/client.js";
import { loadConfig } from "../src/config.js";

interface NetworkObservation {
  method: string;
  path: string;
  resourceType: string;
  count: number;
  statuses: Set<number>;
  contentTypes: Set<string>;
  contentDispositionCount: number;
}

interface CourseTarget {
  courseId: string;
  toolId: string;
}

interface JsonArrayShape {
  path: string;
  itemCount: number;
  itemFields: string[];
}

interface JsonObjectShape {
  path: string;
  fields: string[];
  fieldTypes: Record<string, string>;
}

interface ResourceResponseShape {
  topLevelFields: string[];
  arrays: JsonArrayShape[];
  objects: JsonObjectShape[];
}

interface ResourceResponseInspection {
  shape: ResourceResponseShape;
  firstViewUrl: string | null;
  firstTitle: string | null;
}

interface ViewUrlInspection {
  status: number;
  contentType: string;
  contentDispositionPresent: boolean;
  contentLength: number | null;
  finalPath: string;
}

interface RenderedPageShape {
  textLength: number;
  canvasCount: number;
  imageCount: number;
  embedCount: number;
  objectCount: number;
  iframeCount: number;
  srcdocCount: number;
}

interface FrameShape extends RenderedPageShape {
  urlPattern: string;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const client = new CanvasClient({
    baseUrl: config.canvasBaseUrl,
    accessToken: config.canvasAccessToken,
    timeoutMs: config.requestTimeoutMs,
  });
  const targetCourseId = process.env["AUDIT_COURSE_ID"]?.trim();
  const courses = await client.getAllPages<Record<string, unknown>>(
    "/api/v1/courses",
    { enrollment_state: "active" },
    config.auditMaxPages,
  );
  const courseIds = courses.items
    .map((course) => asId(course["id"]))
    .filter((id): id is string => id !== undefined)
    .filter((id) => !targetCourseId || id === targetCourseId)
    .slice(0, config.auditMaxCourses);
  const targets: CourseTarget[] = [];
  for (const courseId of courseIds) {
    const tabs = await client.getAllPages<Record<string, unknown>>(
      `/api/v1/courses/${encodeURIComponent(courseId)}/tabs`,
      {},
      config.auditMaxPages,
    );
    for (const tab of tabs.items) {
      if (tab["label"] !== "강의자료실" || typeof tab["id"] !== "string") continue;
      const toolId = /^context_external_tool_(\d+)$/.exec(tab["id"])?.[1];
      if (toolId) targets.push({ courseId, toolId });
    }
  }

  const baseOrigin = new URL(config.canvasBaseUrl).origin;
  const observations = new Map<string, NetworkObservation>();
  const externalObservations = new Map<string, NetworkObservation>();
  const resourceShapes: ResourceResponseShape[] = [];
  const resourceViewUrls: string[] = [];
  const viewUrlInspections: ViewUrlInspection[] = [];
  const domUrlPatterns = new Set<string>();
  const externalDomUrlPatterns = new Set<string>();
  let dataUrlCount = 0;
  let blobUrlCount = 0;
  const dataUrlMimeTypes = new Set<string>();
  const renderedPageShapes: RenderedPageShape[] = [];
  const frameShapes: FrameShape[] = [];
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    for (const target of targets) {
      const launch = await client.getJson<Record<string, unknown>>(
        `/api/v1/courses/${encodeURIComponent(target.courseId)}/external_tools/sessionless_launch`,
        { id: target.toolId, launch_type: "course_navigation" },
      );
      if (typeof launch["url"] !== "string") continue;
      const launchUrl = new URL(launch["url"]);
      if (launchUrl.origin !== baseOrigin || launchUrl.protocol !== "https:") continue;
      const context = await browser.newContext({ serviceWorkers: "block" });
      const page = await context.newPage();
      page.on("request", (request) => recordRequest(observations, request, baseOrigin));
      page.on("request", (request) => recordExternalRequest(externalObservations, request, baseOrigin));
      page.on("response", (response) => {
        recordResponse(observations, response, baseOrigin);
        recordExternalResponse(externalObservations, response, baseOrigin);
      });
      const resourceResponsePromise = page.waitForResponse((response) => {
        const url = safeSameOriginUrl(response.url(), baseOrigin);
        return url?.pathname.endsWith("/resources_db") === true && response.status() === 200;
      }, { timeout: 30_000 });
      await page.goto(launchUrl.toString(), { waitUntil: "domcontentloaded", timeout: 30_000 });
      const resourceResponse = await resourceResponsePromise;
      const resourceInspection = await inspectResourceResponse(resourceResponse);
      if (resourceInspection) {
        resourceShapes.push(resourceInspection.shape);
        if (resourceInspection.firstViewUrl) resourceViewUrls.push(resourceInspection.firstViewUrl);
      }
      await page.waitForTimeout(2_000);
      if (resourceInspection?.firstTitle) {
        await page.route("**/*", async (route) => {
          if (route.request().method() === "GET") await route.continue();
          else await route.abort("blockedbyclient");
        });
        await page.getByText(resourceInspection.firstTitle, { exact: true }).first().click({ noWaitAfter: true, timeout: 5_000 }).catch(() => undefined);
        await page.waitForTimeout(3_000);
        renderedPageShapes.push({
          textLength: (await page.locator("body").innerText().catch(() => "")).length,
          canvasCount: await page.locator("canvas").count(),
          imageCount: await page.locator("img").count(),
          embedCount: await page.locator("embed").count(),
          objectCount: await page.locator("object").count(),
          iframeCount: await page.locator("iframe").count(),
          srcdocCount: await page.locator("[srcdoc]").count(),
        });
        for (const frame of page.frames()) {
          let urlPattern = "non-https";
          try {
            const frameUrl = new URL(frame.url());
            if (frameUrl.protocol === "https:") urlPattern = `${frameUrl.hostname.toLowerCase()}${sanitizeNetworkPath(frameUrl.pathname)}`;
            else urlPattern = frameUrl.protocol;
          } catch {
            urlPattern = "invalid";
          }
          frameShapes.push({
            urlPattern,
            textLength: (await frame.locator("body").innerText().catch(() => "")).length,
            canvasCount: await frame.locator("canvas").count(),
            imageCount: await frame.locator("img").count(),
            embedCount: await frame.locator("embed").count(),
            objectCount: await frame.locator("object").count(),
            iframeCount: await frame.locator("iframe").count(),
            srcdocCount: await frame.locator("[srcdoc]").count(),
          });
        }
      }
      const domUrls = await page.locator("[href], [src], object[data], embed[src], [data-url], [data-href], [data-file-url]").evaluateAll((elements) =>
        elements.flatMap((element) => ["href", "src", "data", "data-url", "data-href", "data-file-url"]
          .map((attribute) => element.getAttribute(attribute))
          .filter((value): value is string => typeof value === "string" && value.length > 0)),
      );
      for (const value of domUrls) {
        try {
          if (value.startsWith("data:")) {
            dataUrlCount += 1;
            const mimeType = /^data:([^;,]+)/i.exec(value)?.[1]?.toLowerCase();
            if (mimeType) dataUrlMimeTypes.add(mimeType);
            continue;
          }
          if (value.startsWith("blob:")) {
            blobUrlCount += 1;
            continue;
          }
          const url = new URL(value, baseOrigin);
          if (url.protocol !== "https:") continue;
          const pattern = sanitizeNetworkPath(url.pathname);
          if (url.origin === baseOrigin) {
            if (/(file|resource|download|content|attach|viewer|preview)/i.test(pattern)) domUrlPatterns.add(pattern);
          } else if (externalDomUrlPatterns.size < 50) {
            externalDomUrlPatterns.add(`${url.hostname.toLowerCase()}${pattern}`);
          }
        } catch {
          // Invalid DOM URLs are ignored; raw values are never recorded.
        }
      }
      const firstViewUrl = resourceViewUrls[0];
      if (firstViewUrl) {
        const viewUrl = new URL(firstViewUrl, baseOrigin);
        if (viewUrl.protocol === "https:" && viewUrl.origin === baseOrigin) {
          const response = await context.request.get(viewUrl.toString(), { failOnStatusCode: false, maxRedirects: 5 });
          const finalUrl = new URL(response.url());
          const contentLengthValue = response.headers()["content-length"];
          const contentLength = contentLengthValue ? Number(contentLengthValue) : Number.NaN;
          viewUrlInspections.push({
            status: response.status(),
            contentType: (response.headers()["content-type"] ?? "").split(";", 1)[0]?.trim().toLowerCase() ?? "",
            contentDispositionPresent: typeof response.headers()["content-disposition"] === "string",
            contentLength: Number.isSafeInteger(contentLength) && contentLength >= 0 ? contentLength : null,
            finalPath: sanitizeNetworkPath(finalUrl.pathname),
          });
        }
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }

  const result = {
    schemaVersion: 1,
    readOnly: true,
    targetCourseCount: courseIds.length,
    learningResourceTabCount: targets.length,
    requests: [...observations.values()]
      .filter((item) => /(api|file|lecture|content|resource|download|board|attach)/i.test(item.path))
      .sort((left, right) => `${left.method} ${left.path}`.localeCompare(`${right.method} ${right.path}`))
      .slice(0, 100)
      .map((item) => ({
        method: item.method,
        path: item.path,
        resourceType: item.resourceType,
        count: item.count,
        statuses: [...item.statuses].sort((left, right) => left - right),
        contentTypes: [...item.contentTypes].sort(),
        contentDispositionCount: item.contentDispositionCount,
      })),
    externalRequests: [...externalObservations.values()]
      .filter((item) => ["document", "xhr", "fetch", "image", "media", "other"].includes(item.resourceType))
      .sort((left, right) => `${left.method} ${left.path}`.localeCompare(`${right.method} ${right.path}`))
      .slice(0, 100)
      .map((item) => ({
        method: item.method,
        path: item.path,
        resourceType: item.resourceType,
        count: item.count,
        statuses: [...item.statuses].sort((left, right) => left - right),
        contentTypes: [...item.contentTypes].sort(),
        contentDispositionCount: item.contentDispositionCount,
      })),
    resourceResponseShapes: resourceShapes,
    viewUrlInspections,
    domUrlPatterns: [...domUrlPatterns].sort(),
    externalDomUrlPatterns: [...externalDomUrlPatterns].sort(),
    dataUrlCount,
    blobUrlCount,
    dataUrlMimeTypes: [...dataUrlMimeTypes].sort(),
    renderedPageShapes,
    frameShapes,
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function recordRequest(observations: Map<string, NetworkObservation>, request: Request, baseOrigin: string): void {
  const url = safeSameOriginUrl(request.url(), baseOrigin);
  if (!url) return;
  const path = sanitizeNetworkPath(url.pathname);
  const key = `${request.method()} ${path} ${request.resourceType()}`;
  const current = observations.get(key) ?? {
    method: request.method(),
    path,
    resourceType: request.resourceType(),
    count: 0,
    statuses: new Set<number>(),
    contentTypes: new Set<string>(),
    contentDispositionCount: 0,
  };
  current.count += 1;
  observations.set(key, current);
}

function recordResponse(observations: Map<string, NetworkObservation>, response: Response, baseOrigin: string): void {
  const request = response.request();
  const url = safeSameOriginUrl(request.url(), baseOrigin);
  if (!url) return;
  const path = sanitizeNetworkPath(url.pathname);
  const key = `${request.method()} ${path} ${request.resourceType()}`;
  const current = observations.get(key);
  if (current) {
    current.statuses.add(response.status());
    const headers = response.headers();
    const contentType = (headers["content-type"] ?? "").split(";", 1)[0]?.trim().toLowerCase();
    if (contentType) current.contentTypes.add(contentType);
    if (typeof headers["content-disposition"] === "string") current.contentDispositionCount += 1;
  }
}

function recordExternalRequest(observations: Map<string, NetworkObservation>, request: Request, baseOrigin: string): void {
  const url = safeHttpsUrl(request.url());
  if (!url || url.origin === baseOrigin) return;
  const path = `${url.hostname.toLowerCase()}${sanitizeNetworkPath(url.pathname)}`;
  const key = `${request.method()} ${path} ${request.resourceType()}`;
  const current = observations.get(key) ?? {
    method: request.method(),
    path,
    resourceType: request.resourceType(),
    count: 0,
    statuses: new Set<number>(),
    contentTypes: new Set<string>(),
    contentDispositionCount: 0,
  };
  current.count += 1;
  observations.set(key, current);
}

function recordExternalResponse(observations: Map<string, NetworkObservation>, response: Response, baseOrigin: string): void {
  const request = response.request();
  const url = safeHttpsUrl(request.url());
  if (!url || url.origin === baseOrigin) return;
  const path = `${url.hostname.toLowerCase()}${sanitizeNetworkPath(url.pathname)}`;
  const key = `${request.method()} ${path} ${request.resourceType()}`;
  const current = observations.get(key);
  if (!current) return;
  current.statuses.add(response.status());
  const headers = response.headers();
  const contentType = (headers["content-type"] ?? "").split(";", 1)[0]?.trim().toLowerCase();
  if (contentType) current.contentTypes.add(contentType);
  if (typeof headers["content-disposition"] === "string") current.contentDispositionCount += 1;
}

function safeSameOriginUrl(value: string, baseOrigin: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === baseOrigin ? url : null;
  } catch {
    return null;
  }
}

function safeHttpsUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function sanitizeNetworkPath(pathname: string): string {
  const segments = pathname.split("/").map((segment) => {
    if (!segment) return segment;
    if (/^\d+$/.test(segment)) return ":id";
    if (/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(segment)) return ":uuid";
    if (/^[0-9a-f]{8,}$/i.test(segment)) return ":token";
    if (segment.includes("%") || !/^[A-Za-z0-9._-]+$/.test(segment) || segment.length > 48) return ":value";
    return segment;
  });
  return segments.join("/").slice(0, 240);
}

function asId(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  return undefined;
}

async function inspectResourceResponse(response: Response): Promise<ResourceResponseInspection | null> {
  try {
    const value = await response.json() as unknown;
    return {
      shape: {
        topLevelFields: isRecord(value) ? Object.keys(value).sort().slice(0, 100) : [],
        arrays: collectArrayShapes(value),
        objects: collectObjectShapes(value),
      },
      firstViewUrl: findFirstViewUrl(value),
      firstTitle: findFirstStringField(value, "title"),
    };
  } catch {
    return null;
  }
}

function findFirstViewUrl(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  for (const item of value) {
    if (!isRecord(item) || !isRecord(item["commons_content"])) continue;
    const viewUrl = item["commons_content"]["view_url"];
    if (typeof viewUrl === "string" && viewUrl.length > 0) return viewUrl;
  }
  return null;
}

function findFirstStringField(value: unknown, field: string): string | null {
  if (!Array.isArray(value)) return null;
  for (const item of value) {
    if (!isRecord(item)) continue;
    const candidate = item[field];
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
  }
  return null;
}

function collectArrayShapes(value: unknown, path = "$", depth = 0): JsonArrayShape[] {
  if (depth > 4) return [];
  if (Array.isArray(value)) {
    const firstObject = value.find(isRecord);
    const current: JsonArrayShape = {
      path,
      itemCount: value.length,
      itemFields: firstObject ? Object.keys(firstObject).sort().slice(0, 100) : [],
    };
    const nested = firstObject
      ? Object.entries(firstObject).flatMap(([key, child]) => collectArrayShapes(child, `${path}[].${key}`, depth + 1))
      : [];
    return [current, ...nested];
  }
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, child]) => collectArrayShapes(child, `${path}.${key}`, depth + 1));
}

function collectObjectShapes(value: unknown, path = "$", depth = 0): JsonObjectShape[] {
  if (depth > 4) return [];
  if (Array.isArray(value)) {
    const firstObject = value.find(isRecord);
    return firstObject ? collectObjectShapes(firstObject, `${path}[]`, depth + 1) : [];
  }
  if (!isRecord(value)) return [];
  const fields = Object.keys(value).sort().slice(0, 100);
  const current: JsonObjectShape = {
    path,
    fields,
    fieldTypes: Object.fromEntries(fields.map((field) => [field, jsonType(value[field])])),
  };
  const nested = Object.entries(value).flatMap(([key, child]) => collectObjectShapes(child, `${path}.${key}`, depth + 1));
  return [current, ...nested];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

main().catch(() => {
  process.stderr.write("강의자료실 브라우저 감사를 완료하지 못했습니다. 민감정보 보호를 위해 상세 응답은 출력하지 않습니다.\n");
  process.exitCode = 1;
});
