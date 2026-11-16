import { z } from "zod";

const ResourceSchema = z.object({
  resourceLocator: z.string().regex(/^(course-resource|module-item):\d+$/),
  location: z.enum(["course_resource", "module_item"]),
  resourceId: z.string().regex(/^\d+$/).nullable(),
  moduleId: z.string().regex(/^\d+$/).nullable(),
  moduleItemId: z.string().regex(/^\d+$/).nullable(),
  moduleName: z.string().nullable(),
  title: z.string(),
  fileName: z.string().nullable(),
  contentType: z.string().nullable(),
  position: z.number().int().nullable(),
  published: z.boolean().nullable(),
  pdfAvailable: z.boolean(),
  cached: z.boolean(),
});

const ResourceListSchema = z.object({
  courseId: z.string().regex(/^\d+$/),
  resources: z.array(ResourceSchema),
});

const ResourceTextSchema = z.object({
  courseId: z.string().regex(/^\d+$/),
  resourceLocator: z.string().regex(/^(course-resource|module-item):\d+$/),
  location: z.enum(["course_resource", "module_item"]),
  resourceId: z.string().regex(/^\d+$/).nullable(),
  moduleItemId: z.string().regex(/^\d+$/).nullable(),
  title: z.string(),
  text: z.string(),
  offset: z.number().int().nonnegative(),
  nextOffset: z.number().int().nonnegative().nullable(),
  totalChars: z.number().int().nonnegative(),
  cachedAt: z.string().datetime({ offset: true }),
});

export class LearningResourceClient {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async list(courseId: string): Promise<Record<string, unknown>> {
    const value = ResourceListSchema.parse(await this.get(`/courses/${encodeURIComponent(courseId)}/resources`));
    return { source: "HY-ON 강의자료실 및 주차별 학습 모듈", untrustedContent: true, ...value };
  }

  async getText(
    courseId: string,
    resourceId: string | undefined,
    resourceLocator: string | undefined,
    offset: number,
    maxChars: number,
  ): Promise<Record<string, unknown>> {
    const locator = resourceLocator ?? (resourceId ? `course-resource:${resourceId}` : undefined);
    if (!locator) throw new Error("learning resource locator is required");
    const params = new URLSearchParams({ locator, offset: String(offset), maxChars: String(maxChars) });
    const value = ResourceTextSchema.parse(await this.get(
      `/courses/${encodeURIComponent(courseId)}/resources/text?${params.toString()}`,
    ));
    return { source: "HY-ON 학습자료 원본 PDF", untrustedContent: true, ...value };
  }

  private async get(path: string): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(this.timeoutMs, 120_000));
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: "GET",
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`learning worker status ${response.status}`);
      return await response.json() as unknown;
    } finally {
      clearTimeout(timeout);
    }
  }
}
