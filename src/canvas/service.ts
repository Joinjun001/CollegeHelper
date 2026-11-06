import { z } from "zod";

import { htmlToPlainText } from "../security/html-to-text.js";
import type { CanvasClient } from "./client.js";

const IdentifierSchema = z.union([z.string().min(1), z.number().int().safe()]).transform(String);
const NullableDateSchema = z.string().datetime({ offset: true }).nullable().optional();

const CourseSchema = z.object({
  id: IdentifierSchema,
  name: z.string().min(1),
  course_code: z.string().optional(),
  workflow_state: z.string().optional(),
  start_at: NullableDateSchema,
  end_at: NullableDateSchema,
}).passthrough();

const AssignmentSchema = z.object({
  id: IdentifierSchema,
  course_id: IdentifierSchema.optional(),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  due_at: NullableDateSchema,
  unlock_at: NullableDateSchema,
  lock_at: NullableDateSchema,
  submission_types: z.array(z.string()).optional(),
  html_url: z.string().url().optional(),
  published: z.boolean().optional(),
}).passthrough();

const SubmissionSchema = z.object({
  workflow_state: z.string().optional(),
  submitted_at: NullableDateSchema,
  late: z.boolean().optional(),
  missing: z.boolean().optional(),
  attempt: z.number().int().nullable().optional(),
}).passthrough();

const AnnouncementSchema = z.object({
  id: IdentifierSchema,
  title: z.string().min(1),
  message: z.string().nullable().optional(),
  html_url: z.string().url().optional(),
  posted_at: NullableDateSchema,
  context_code: z.string().optional(),
}).passthrough();

const ModuleSchema = z.object({
  id: IdentifierSchema,
  name: z.string().min(1),
  position: z.number().int().optional(),
  state: z.string().optional(),
  unlock_at: NullableDateSchema,
  items_count: z.number().int().optional(),
}).passthrough();

export type TaskState = "all" | "pending" | "submitted";

export interface DateRange {
  startAt: Date;
  endAt: Date;
}

export class CanvasService {
  constructor(
    private readonly client: CanvasClient,
    private readonly maxPages: number,
  ) {}

  async listCourses(): Promise<Record<string, unknown>> {
    const page = await this.client.getAllPages<unknown>("/api/v1/courses", { enrollment_state: "active" }, this.maxPages);
    const courses = page.items.flatMap((item) => {
      const parsed = CourseSchema.safeParse(item);
      if (!parsed.success) return [];
      const course = parsed.data;
      return [{
        id: course.id,
        name: course.name,
        code: course.course_code ?? null,
        state: course.workflow_state ?? null,
        startAt: course.start_at ?? null,
        endAt: course.end_at ?? null,
        url: this.client.webUrl(`/courses/${encodeURIComponent(course.id)}`),
      }];
    });
    return envelope({ courses, truncated: page.truncated });
  }

  async listTasks(range: DateRange, state: TaskState): Promise<Record<string, unknown>> {
    const coursesResult = await this.activeCourses();
    const courseNames = new Map(coursesResult.map((course) => [course.id, course.name]));
    const assignments = (await mapWithConcurrency(coursesResult, 4, async (course) => {
      const page = await this.client.getAllPages<unknown>(
        `/api/v1/courses/${encodeURIComponent(course.id)}/assignments`,
        { order_by: "due_at" },
        this.maxPages,
      );
      return page.items.flatMap((item) => {
        const parsed = AssignmentSchema.safeParse(item);
        if (!parsed.success || !parsed.data.due_at) return [];
        const dueAt = new Date(parsed.data.due_at);
        if (dueAt < range.startAt || dueAt >= range.endAt) return [];
        return [{ courseId: course.id, assignment: parsed.data }];
      });
    })).flat();

    const tasks = await mapWithConcurrency(assignments, 4, async ({ courseId, assignment }) => {
      const submission = await this.getSubmission(courseId, assignment.id);
      return {
        id: assignment.id,
        courseId,
        courseName: courseNames.get(courseId) ?? "알 수 없는 과목",
        name: assignment.name,
        dueAt: assignment.due_at ?? null,
        status: submission.status,
        late: submission.late,
        missing: submission.missing,
        attempt: submission.attempt,
        url: this.client.trustedWebUrl(assignment.html_url) ?? this.client.webUrl(`/courses/${encodeURIComponent(courseId)}/assignments/${encodeURIComponent(assignment.id)}`),
      };
    });
    const filtered = tasks.filter((task) => state === "all" || task.status === state);
    filtered.sort((left, right) => String(left.dueAt).localeCompare(String(right.dueAt)));
    return envelope({ range: { startAt: range.startAt.toISOString(), endAt: range.endAt.toISOString() }, state, tasks: filtered });
  }

  async listAnnouncements(days: number): Promise<Record<string, unknown>> {
    const courses = await this.activeCourses();
    if (courses.length === 0) return envelope({ announcements: [] });
    const courseNames = new Map(courses.map((course) => [`course_${course.id}`, course.name]));
    const startAt = new Date(Date.now() - days * 86_400_000);
    const page = await this.client.getAllPages<unknown>("/api/v1/announcements", {
      "context_codes[]": courses.map((course) => `course_${course.id}`),
      start_date: startAt.toISOString(),
    }, this.maxPages);
    const announcements = page.items.flatMap((item) => {
      const parsed = AnnouncementSchema.safeParse(item);
      if (!parsed.success) return [];
      const announcement = parsed.data;
      if (announcement.posted_at && new Date(announcement.posted_at) < startAt) return [];
      return [{
        id: announcement.id,
        courseName: courseNames.get(announcement.context_code ?? "") ?? null,
        title: announcement.title,
        message: htmlToPlainText(announcement.message),
        postedAt: announcement.posted_at ?? null,
        url: this.client.trustedWebUrl(announcement.html_url),
      }];
    });
    announcements.sort((left, right) => String(right.postedAt).localeCompare(String(left.postedAt)));
    return envelope({ announcements, truncated: page.truncated });
  }

  async listModules(courseId: string): Promise<Record<string, unknown>> {
    const page = await this.client.getAllPages<unknown>(
      `/api/v1/courses/${encodeURIComponent(courseId)}/modules`,
      {},
      this.maxPages,
    );
    const modules = page.items.flatMap((item) => {
      const parsed = ModuleSchema.safeParse(item);
      if (!parsed.success) return [];
      const module = parsed.data;
      return [{
        id: module.id,
        name: module.name,
        position: module.position ?? null,
        state: module.state ?? null,
        unlockAt: module.unlock_at ?? null,
        itemCount: module.items_count ?? null,
      }];
    });
    modules.sort((left, right) => Number(left.position ?? Number.MAX_SAFE_INTEGER) - Number(right.position ?? Number.MAX_SAFE_INTEGER));
    return envelope({ courseId, modules, truncated: page.truncated });
  }

  async getAssignmentContext(courseId: string, assignmentId: string): Promise<Record<string, unknown>> {
    const page = await this.client.getAllPages<unknown>(
      `/api/v1/courses/${encodeURIComponent(courseId)}/assignments`,
      {},
      this.maxPages,
    );
    const assignment = page.items
      .map((item) => AssignmentSchema.safeParse(item))
      .find((result) => result.success && result.data.id === assignmentId);
    if (!assignment?.success) throw new Error("요청한 과제를 현재 수강 과목에서 찾을 수 없습니다.");
    const value = assignment.data;
    const submission = await this.getSubmission(courseId, assignmentId);
    return envelope({
      assignment: {
        id: value.id,
        courseId,
        name: value.name,
        description: htmlToPlainText(value.description),
        dueAt: value.due_at ?? null,
        unlockAt: value.unlock_at ?? null,
        lockAt: value.lock_at ?? null,
        submissionTypes: value.submission_types ?? [],
        published: value.published ?? null,
        status: submission,
        url: this.client.trustedWebUrl(value.html_url) ?? this.client.webUrl(`/courses/${encodeURIComponent(courseId)}/assignments/${encodeURIComponent(assignmentId)}`),
      },
    });
  }

  private async activeCourses(): Promise<Array<{ id: string; name: string }>> {
    const page = await this.client.getAllPages<unknown>("/api/v1/courses", { enrollment_state: "active" }, this.maxPages);
    return page.items.flatMap((item) => {
      const parsed = CourseSchema.safeParse(item);
      return parsed.success ? [{ id: parsed.data.id, name: parsed.data.name }] : [];
    });
  }

  private async getSubmission(courseId: string, assignmentId: string): Promise<{
    status: "pending" | "submitted";
    late: boolean;
    missing: boolean;
    attempt: number | null;
  }> {
    const raw = await this.client.getJson<unknown>(
      `/api/v1/courses/${encodeURIComponent(courseId)}/assignments/${encodeURIComponent(assignmentId)}/submissions/self`,
    );
    const parsed = SubmissionSchema.safeParse(raw);
    if (!parsed.success) return { status: "pending", late: false, missing: false, attempt: null };
    const submission = parsed.data;
    const submitted = Boolean(submission.submitted_at) || ["submitted", "graded", "pending_review"].includes(submission.workflow_state ?? "");
    return {
      status: submitted ? "submitted" : "pending",
      late: submission.late ?? false,
      missing: submission.missing ?? false,
      attempt: submission.attempt ?? null,
    };
  }
}

export function seoulDayRange(date: string, days = 1): DateRange {
  const startAt = new Date(`${date}T00:00:00+09:00`);
  if (Number.isNaN(startAt.getTime())) throw new Error("날짜는 YYYY-MM-DD 형식이어야 합니다.");
  return { startAt, endAt: new Date(startAt.getTime() + days * 86_400_000) };
}

export function todayInSeoul(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function envelope(payload: Record<string, unknown>): Record<string, unknown> {
  return { source: "Canvas LMS", untrustedContent: true, ...payload };
}

async function mapWithConcurrency<T, R>(items: readonly T[], concurrency: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index] as T);
    }
  });
  await Promise.all(workers);
  return results;
}
