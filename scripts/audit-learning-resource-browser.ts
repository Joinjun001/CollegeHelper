import { chromium, type Request, type Response } from "playwright";

import { CanvasClient } from "../src/canvas/client.js";
import { loadConfig } from "../src/config.js";

interface NetworkObservation {
  method: string;
  path: string;
  resourceType: string;
  count: number;
  statuses: Set<number>;
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
}

interface ResourceResponseShape {
  topLevelFields: string[];
  arrays: JsonArrayShape[];
  objects: JsonObjectShape[];
}

interface ResourceResponseInspection {
  shape: ResourceResponseShape;
  firstViewUrl: string | null;
}

interface ViewUrlInspection {
  status: number;
  contentType: string;
  contentDispositionPresent: boolean;
  contentLength: number | null;
  finalPath: string;
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
  const resourceShapes: ResourceResponseShape[] = [];
  const resourceViewUrls: string[] = [];
  const viewUrlInspections: ViewUrlInspection[] = [];
  const shapeInspections: Array<Promise<void>> = [];
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
      page.on("response", (response) => {
        recordResponse(observations, response, baseOrigin);
        const url = safeSameOriginUrl(response.url(), baseOrigin);
        if (url?.pathname.endsWith("/resources_db") && response.status() === 200) {
          shapeInspections.push(inspectResourceResponse(response).then((inspection) => {
            if (!inspection) return;
            resourceShapes.push(inspection.shape);
            if (inspection.firstViewUrl) resourceViewUrls.push(inspection.firstViewUrl);
          }));
        }
      });
      await page.goto(launchUrl.toString(), { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForTimeout(8_000);
      await Promise.all(shapeInspections);
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
  await Promise.all(shapeInspections);

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
      })),
    resourceResponseShapes: resourceShapes,
    viewUrlInspections,
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
  if (current) current.statuses.add(response.status());
}

function safeSameOriginUrl(value: string, baseOrigin: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === baseOrigin ? url : null;
  } catch {
    return null;
  }
}

function sanitizeNetworkPath(pathname: string): string {
  const segments = pathname.split("/").map((segment) => {
    if (!segment) return segment;
    if (/^\d+$/.test(segment)) return ":id";
    if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment)) return ":uuid";
    if (/^[0-9a-f]{16,}$/i.test(segment)) return ":token";
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
  const current: JsonObjectShape = { path, fields: Object.keys(value).sort().slice(0, 100) };
  const nested = Object.entries(value).flatMap(([key, child]) => collectObjectShapes(child, `${path}.${key}`, depth + 1));
  return [current, ...nested];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

main().catch(() => {
  process.stderr.write("강의자료실 브라우저 감사를 완료하지 못했습니다. 민감정보 보호를 위해 상세 응답은 출력하지 않습니다.\n");
  process.exitCode = 1;
});
