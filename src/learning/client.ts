import { z } from "zod";

const ResourceSchema = z.object({
  resourceId: z.string().regex(/^\d+$/),
  title: z.string(),
  fileName: z.string().nullable(),
  contentType: z.string().nullable(),
  position: z.number().int().nullable(),
  published: z.boolean().nullable(),
  cached: z.boolean(),
});

const ResourceListSchema = z.object({
  courseId: z.string().regex(/^\d+$/),
  resources: z.array(ResourceSchema),
});

const ResourceTextSchema = z.object({
  courseId: z.string().regex(/^\d+$/),
  resourceId: z.string().regex(/^\d+$/),
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
    return { source: "HY-ON 강의자료실", untrustedContent: true, ...value };
  }

  async getText(courseId: string, resourceId: string, offset: number, maxChars: number): Promise<Record<string, unknown>> {
    const params = new URLSearchParams({ offset: String(offset), maxChars: String(maxChars) });
    const value = ResourceTextSchema.parse(await this.get(
      `/courses/${encodeURIComponent(courseId)}/resources/${encodeURIComponent(resourceId)}/text?${params.toString()}`,
    ));
    return { source: "HY-ON 강의자료실 원본 PDF", untrustedContent: true, ...value };
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
