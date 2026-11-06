export type CanvasErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "UPSTREAM_TIMEOUT"
  | "UPSTREAM_ERROR"
  | "INVALID_RESPONSE";

export class CanvasError extends Error {
  constructor(
    public readonly code: CanvasErrorCode,
    message: string,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "CanvasError";
  }
}

export function errorFromStatus(status: number): CanvasError {
  switch (status) {
    case 401:
      return new CanvasError("UNAUTHORIZED", "Canvas 인증에 실패했습니다.", status);
    case 403:
      return new CanvasError("FORBIDDEN", "Canvas 리소스에 접근할 권한이 없습니다.", status);
    case 404:
      return new CanvasError("NOT_FOUND", "Canvas 리소스를 찾을 수 없습니다.", status);
    case 429:
      return new CanvasError("RATE_LIMITED", "Canvas 요청 한도를 초과했습니다.", status);
    default:
      return new CanvasError("UPSTREAM_ERROR", "Canvas API 요청에 실패했습니다.", status);
  }
}
