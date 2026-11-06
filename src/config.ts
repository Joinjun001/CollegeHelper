import { z } from "zod";

const EnvironmentSchema = z
  .object({
    CANVAS_BASE_URL: z.url(),
    CANVAS_ACCESS_TOKEN: z.string().trim().min(1, "값이 필요합니다."),
    CANVAS_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(15_000),
    AUDIT_MAX_PAGES: z.coerce.number().int().min(1).max(10).default(10),
    AUDIT_MAX_COURSES: z.coerce.number().int().min(1).max(10).default(3),
    REPORTS_DIR: z.string().trim().min(1).default("reports"),
    MCP_HOST: z.enum(["127.0.0.1", "::1", "0.0.0.0"]).default("127.0.0.1"),
    MCP_PORT: z.coerce.number().int().min(1).max(65_535).default(3_000),
  })
  .superRefine((value, context) => {
    const url = new URL(value.CANVAS_BASE_URL);
    if (url.protocol !== "https:") {
      context.addIssue({
        code: "custom",
        path: ["CANVAS_BASE_URL"],
        message: "HTTPS 주소여야 합니다.",
      });
    }
    if (url.username || url.password || url.search || url.hash) {
      context.addIssue({
        code: "custom",
        path: ["CANVAS_BASE_URL"],
        message: "인증정보, 쿼리 또는 해시를 포함할 수 없습니다.",
      });
    }
    if (url.pathname !== "/" && url.pathname !== "") {
      context.addIssue({
        code: "custom",
        path: ["CANVAS_BASE_URL"],
        message: "/api/v1 경로를 제외한 Canvas 루트 주소를 입력해야 합니다.",
      });
    }
  });

export interface AppConfig {
  canvasBaseUrl: string;
  canvasAccessToken: string;
  requestTimeoutMs: number;
  auditMaxPages: number;
  auditMaxCourses: number;
  reportsDir: string;
  mcpHost: "127.0.0.1" | "::1" | "0.0.0.0";
  mcpPort: number;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = EnvironmentSchema.safeParse(environment);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".") || "환경변수"}: ${issue.message}`)
      .join("; ");
    throw new ConfigError(`환경 설정이 올바르지 않습니다. ${details}`);
  }

  const baseUrl = new URL(result.data.CANVAS_BASE_URL);
  baseUrl.pathname = "/";
  return {
    canvasBaseUrl: baseUrl.toString().replace(/\/$/, ""),
    canvasAccessToken: result.data.CANVAS_ACCESS_TOKEN,
    requestTimeoutMs: result.data.CANVAS_REQUEST_TIMEOUT_MS,
    auditMaxPages: result.data.AUDIT_MAX_PAGES,
    auditMaxCourses: result.data.AUDIT_MAX_COURSES,
    reportsDir: result.data.REPORTS_DIR,
    mcpHost: result.data.MCP_HOST,
    mcpPort: result.data.MCP_PORT,
  };
}
