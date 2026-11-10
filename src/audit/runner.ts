import type { CanvasClient, CanvasPage, Query } from "../canvas/client.js";
import { CanvasError } from "../canvas/errors.js";
import type { AuditResult, AuditStatus } from "./types.js";

type JsonObject = Record<string, unknown>;

interface AuditContext {
  courseIds: string[];
  assignmentIds: Map<string, string>;
  moduleIds: Map<string, string[]>;
  moduleFileIds: string[];
}

interface Observation {
  values: unknown[];
  pagination: boolean;
  called: boolean;
  notes?: string[];
}

interface EndpointDefinition {
  id: string;
  name: string;
  path: string;
  execute: (context: AuditContext) => Promise<Observation>;
}

const SENSITIVE_FIELD = /(^|_)(email|sis_user_id|login_id|score|grade|body|description|submission|download_url|uuid|token|cookie)($|_)/i;
const MAX_AUDIT_MODULES_PER_COURSE = 20;
const MAX_AUDIT_MODULE_FILES = 10;

export interface AuditRunnerOptions {
  maxPages: number;
  maxCourses: number;
}

export async function runCanvasAudit(client: CanvasClient, options: AuditRunnerOptions): Promise<AuditResult[]> {
  const context: AuditContext = {
    courseIds: [],
    assignmentIds: new Map(),
    moduleIds: new Map(),
    moduleFileIds: [],
  };
  const definitions = createDefinitions(client, options);
  const results: AuditResult[] = [];

  for (const definition of definitions) {
    try {
      const observation = await definition.execute(context);
      const objects = observation.values.filter(isJsonObject);
      const fields = [...new Set(objects.flatMap((value) => Object.keys(value)))].sort().slice(0, 100);
      results.push({
        id: definition.id,
        name: definition.name,
        method: "GET",
        path: definition.path,
        status: observation.values.length === 0 ? "empty" : "supported",
        ...(observation.called ? { httpStatus: 200 } : {}),
        itemCount: observation.values.length,
        pagination: observation.pagination,
        fields,
        containsSensitiveData: fields.some((field) => SENSITIVE_FIELD.test(field)),
        notes: observation.notes ?? (observation.values.length === 0 ? ["호출은 성공했지만 현재 데이터가 없습니다."] : []),
      });
    } catch (error) {
      results.push(errorResult(definition, error));
    }
  }
  return results;
}

function createDefinitions(client: CanvasClient, options: AuditRunnerOptions): EndpointDefinition[] {
  const list = async (path: string, query: Query = {}): Promise<CanvasPage<JsonObject>> =>
    client.getAllPages<JsonObject>(path, query, options.maxPages);

  const acrossCourses = async (
    context: AuditContext,
    suffix: string,
    onItems?: (courseId: string, items: JsonObject[]) => void,
  ): Promise<Observation> => {
    const values: unknown[] = [];
    let pagination = false;
    let truncated = false;
    for (const courseId of context.courseIds.slice(0, options.maxCourses)) {
      const page = await list(`/api/v1/courses/${encodeURIComponent(courseId)}/${suffix}`);
      values.push(...page.items);
      pagination ||= page.hadLinkHeader || page.pageCount > 1;
      truncated ||= page.truncated;
      onItems?.(courseId, page.items);
    }
    return {
      values,
      pagination,
      called: context.courseIds.length > 0,
      ...(context.courseIds.length === 0 ? { notes: ["활성 과목이 없어 호출하지 않았습니다."] } : {}),
      ...(truncated ? { notes: ["페이지 상한에 도달해 결과가 일부일 수 있습니다."] } : {}),
    };
  };

  return [
    {
      id: "A01",
      name: "현재 사용자",
      path: "/api/v1/users/self/profile",
      execute: async () => ({ values: [await client.getJson<JsonObject>("/api/v1/users/self/profile")], pagination: false, called: true }),
    },
    {
      id: "A02",
      name: "수강 과목",
      path: "/api/v1/courses",
      execute: async (context) => {
        const page = await list("/api/v1/courses", { enrollment_state: "active" });
        context.courseIds = page.items.map((item) => asId(item.id)).filter((id): id is string => id !== undefined).slice(0, options.maxCourses);
        return { values: page.items, pagination: page.hadLinkHeader || page.pageCount > 1, called: true, ...(page.truncated ? { notes: ["페이지 상한에 도달해 결과가 일부일 수 있습니다."] } : {}) };
      },
    },
    {
      id: "A03",
      name: "과목 상세",
      path: "/api/v1/courses/:course_id",
      execute: async (context) => {
        const values: unknown[] = [];
        for (const courseId of context.courseIds) {
          values.push(await client.getJson<JsonObject>(`/api/v1/courses/${encodeURIComponent(courseId)}`));
        }
        return { values, pagination: false, called: context.courseIds.length > 0, ...(context.courseIds.length === 0 ? { notes: ["활성 과목이 없어 호출하지 않았습니다."] } : {}) };
      },
    },
    {
      id: "A04",
      name: "과제",
      path: "/api/v1/courses/:course_id/assignments",
      execute: (context) => acrossCourses(context, "assignments", (courseId, items) => {
        const firstId = items.map((item) => asId(item.id)).find((id) => id !== undefined);
        if (firstId) context.assignmentIds.set(courseId, firstId);
      }),
    },
    {
      id: "A05",
      name: "본인 제출",
      path: "/api/v1/courses/:course_id/assignments/:assignment_id/submissions/self",
      execute: async (context) => {
        const values: unknown[] = [];
        for (const [courseId, assignmentId] of context.assignmentIds) {
          values.push(await client.getJson<JsonObject>(`/api/v1/courses/${encodeURIComponent(courseId)}/assignments/${encodeURIComponent(assignmentId)}/submissions/self`));
        }
        return { values, pagination: false, called: context.assignmentIds.size > 0, ...(context.assignmentIds.size === 0 ? { notes: ["조사할 과제가 없어 호출하지 않았습니다."] } : {}) };
      },
    },
    {
      id: "A06",
      name: "공지",
      path: "/api/v1/announcements",
      execute: async (context) => {
        if (context.courseIds.length === 0) return { values: [], pagination: false, called: false, notes: ["활성 과목이 없어 호출하지 않았습니다."] };
        const page = await list("/api/v1/announcements", { "context_codes[]": context.courseIds.map((id) => `course_${id}`) });
        return { values: page.items, pagination: page.hadLinkHeader || page.pageCount > 1, called: true, ...(page.truncated ? { notes: ["페이지 상한에 도달해 결과가 일부일 수 있습니다."] } : {}) };
      },
    },
    {
      id: "A07",
      name: "캘린더",
      path: "/api/v1/calendar_events",
      execute: async (context) => {
        const query: Query = context.courseIds.length > 0 ? { "context_codes[]": context.courseIds.map((id) => `course_${id}`) } : {};
        const page = await list("/api/v1/calendar_events", query);
        return { values: page.items, pagination: page.hadLinkHeader || page.pageCount > 1, called: true, ...(page.truncated ? { notes: ["페이지 상한에 도달해 결과가 일부일 수 있습니다."] } : {}) };
      },
    },
    {
      id: "A08",
      name: "모듈",
      path: "/api/v1/courses/:course_id/modules",
      execute: (context) => acrossCourses(context, "modules", (courseId, items) => {
        context.moduleIds.set(
          courseId,
          items.map((item) => asId(item.id)).filter((id): id is string => id !== undefined),
        );
      }),
    },
    {
      id: "A08I",
      name: "모듈 항목",
      path: "/api/v1/courses/:course_id/modules/:module_id/items",
      execute: async (context) => {
        const values: unknown[] = [];
        const typeCounts = new Map<string, number>();
        const externalHostCounts = new Map<string, number>();
        let pagination = false;
        let truncated = false;
        let inspectedModules = 0;
        let totalModules = 0;
        for (const [courseId, moduleIds] of context.moduleIds) {
          totalModules += moduleIds.length;
          for (const moduleId of moduleIds.slice(0, MAX_AUDIT_MODULES_PER_COURSE)) {
            const page = await list(
              `/api/v1/courses/${encodeURIComponent(courseId)}/modules/${encodeURIComponent(moduleId)}/items`,
              { "include[]": ["content_details"] },
            );
            inspectedModules += 1;
            values.push(...page.items);
            pagination ||= page.hadLinkHeader || page.pageCount > 1;
            truncated ||= page.truncated;
            for (const item of page.items) {
              if (typeof item.type === "string") {
                typeCounts.set(item.type, (typeCounts.get(item.type) ?? 0) + 1);
              }
              if (item.type === "ExternalTool" && typeof item.external_url === "string") {
                try {
                  const externalUrl = new URL(item.external_url);
                  if (externalUrl.protocol === "https:") {
                    const hostname = externalUrl.hostname.toLowerCase();
                    externalHostCounts.set(hostname, (externalHostCounts.get(hostname) ?? 0) + 1);
                  }
                } catch {
                  // Invalid external URLs are ignored; raw values are never recorded.
                }
              }
              if (item.type !== "File") continue;
              const fileId = asId(item.content_id);
              if (fileId && !context.moduleFileIds.includes(fileId)) context.moduleFileIds.push(fileId);
            }
          }
        }
        const notes: string[] = [];
        if (totalModules === 0) notes.push("조사할 모듈이 없어 호출하지 않았습니다.");
        if (typeCounts.size > 0) {
          const summary = [...typeCounts.entries()]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([type, count]) => `${type}=${count}`)
            .join(", ");
          notes.push(`모듈 항목 유형 수: ${summary}`);
        }
        if (externalHostCounts.size > 0) {
          const summary = [...externalHostCounts.entries()]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([hostname, count]) => `${hostname}=${count}`)
            .join(", ");
          notes.push(`ExternalTool 호스트 수: ${summary}`);
        }
        if (inspectedModules < totalModules) notes.push(`과목당 최대 ${MAX_AUDIT_MODULES_PER_COURSE}개 모듈만 조사했습니다.`);
        if (truncated) notes.push("페이지 상한에 도달해 결과가 일부일 수 있습니다.");
        return { values, pagination, called: inspectedModules > 0, ...(notes.length > 0 ? { notes } : {}) };
      },
    },
    {
      id: "A09I",
      name: "모듈 연결 파일 메타데이터",
      path: "/api/v1/files/:file_id",
      execute: async (context) => {
        const values: unknown[] = [];
        for (const fileId of context.moduleFileIds.slice(0, MAX_AUDIT_MODULE_FILES)) {
          values.push(await client.getJson<JsonObject>(`/api/v1/files/${encodeURIComponent(fileId)}`));
        }
        const notes: string[] = [];
        if (context.moduleFileIds.length === 0) notes.push("모듈에서 File 유형 항목을 찾지 못해 호출하지 않았습니다.");
        if (context.moduleFileIds.length > MAX_AUDIT_MODULE_FILES) notes.push(`최대 ${MAX_AUDIT_MODULE_FILES}개 파일 메타데이터만 조사했습니다.`);
        return {
          values,
          pagination: false,
          called: context.moduleFileIds.length > 0,
          ...(notes.length > 0 ? { notes } : {}),
        };
      },
    },
    { id: "A09", name: "파일", path: "/api/v1/courses/:course_id/files", execute: (context) => acrossCourses(context, "files") },
    { id: "A10", name: "페이지", path: "/api/v1/courses/:course_id/pages", execute: (context) => acrossCourses(context, "pages") },
    { id: "A11", name: "토론", path: "/api/v1/courses/:course_id/discussion_topics", execute: (context) => acrossCourses(context, "discussion_topics") },
    {
      id: "A12",
      name: "최근 활동",
      path: "/api/v1/users/self/history",
      execute: async () => {
        const page = await list("/api/v1/users/self/history");
        return { values: page.items, pagination: page.hadLinkHeader || page.pageCount > 1, called: true, ...(page.truncated ? { notes: ["페이지 상한에 도달해 결과가 일부일 수 있습니다."] } : {}) };
      },
    },
  ];
}

function errorResult(definition: EndpointDefinition, error: unknown): AuditResult {
  const status = auditStatusFromError(error);
  return {
    id: definition.id,
    name: definition.name,
    method: "GET",
    path: definition.path,
    status,
    ...(error instanceof CanvasError && error.httpStatus !== undefined ? { httpStatus: error.httpStatus } : {}),
    itemCount: 0,
    pagination: false,
    fields: [],
    containsSensitiveData: false,
    notes: [safeErrorNote(error)],
  };
}

function auditStatusFromError(error: unknown): AuditStatus {
  if (!(error instanceof CanvasError)) return "error";
  switch (error.code) {
    case "UNAUTHORIZED":
      return "unauthorized";
    case "FORBIDDEN":
      return "forbidden";
    case "NOT_FOUND":
      return "not_found";
    default:
      return "error";
  }
}

function safeErrorNote(error: unknown): string {
  if (error instanceof CanvasError) return `${error.code}: ${error.message}`;
  return "분류되지 않은 감사 오류가 발생했습니다.";
}

function asId(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  return undefined;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
