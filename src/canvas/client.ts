import { CanvasError, errorFromStatus } from "./errors.js";
import { parseLinkHeader, validateNextPageUrl } from "./pagination.js";

export type QueryValue = string | number | boolean | readonly string[] | undefined;
export type Query = Readonly<Record<string, QueryValue>>;

export interface CanvasClientOptions {
  baseUrl: string;
  accessToken: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

export interface CanvasPage<T> {
  items: T[];
  pageCount: number;
  hadLinkHeader: boolean;
  truncated: boolean;
}

export interface SessionlessLaunchInspection {
  httpStatus: number;
  contentType: string;
  redirectHost: string | null;
  formActionHost: string | null;
  formMethod: string | null;
}

export interface LtiFormSubmissionInspection {
  httpStatus: number;
  contentType: string;
  redirectHost: string | null;
  setsCookie: boolean;
  anchorCount: number;
  pdfLinkCount: number;
  downloadLinkCount: number;
  iframeCount: number;
  formCount: number;
  hiddenInputCount: number;
  scriptCount: number;
  externalScriptCount: number;
  inlineScriptCount: number;
  jsonScriptCount: number;
  scriptSourceHosts: string[];
  metaRefreshCount: number;
  nextFormActionHost: string | null;
  nextFormMethod: string | null;
}

interface JsonResponse<T> {
  data: T;
  headers: Headers;
  url: URL;
}

export class CanvasClient {
  private readonly baseUrl: URL;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: CanvasClientOptions) {
    this.baseUrl = new URL(options.baseUrl);
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async getJson<T>(path: string, query: Query = {}): Promise<T> {
    const url = this.buildApiUrl(path, query);
    return (await this.requestJson<T>(url)).data;
  }

  webUrl(path: string): string {
    if (!path.startsWith("/")) {
      throw new CanvasError("INVALID_RESPONSE", "Canvas 웹 경로는 /로 시작해야 합니다.");
    }
    const url = new URL(path, this.baseUrl);
    if (url.origin !== this.baseUrl.origin) {
      throw new CanvasError("INVALID_RESPONSE", "Canvas 호스트 밖의 웹 주소를 만들 수 없습니다.");
    }
    return url.toString();
  }

  trustedWebUrl(value: string | undefined): string | null {
    if (!value) return null;
    try {
      const url = new URL(value, this.baseUrl);
      return url.origin === this.baseUrl.origin && url.protocol === "https:" ? url.toString() : null;
    } catch {
      return null;
    }
  }

  async inspectSessionlessLaunch(value: string): Promise<SessionlessLaunchInspection> {
    const url = new URL(value, this.baseUrl);
    if (url.protocol !== "https:" || url.origin !== this.baseUrl.origin) {
      throw new CanvasError("INVALID_RESPONSE", "외부도구 실행 URL이 허용된 Canvas 호스트가 아닙니다.");
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "GET",
        headers: { Accept: "text/html,application/xhtml+xml" },
        redirect: "manual",
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new CanvasError("UPSTREAM_TIMEOUT", "외부도구 실행 URL 확인 시간이 초과되었습니다.");
      }
      throw new CanvasError("UPSTREAM_ERROR", "외부도구 실행 URL에 연결할 수 없습니다.");
    } finally {
      clearTimeout(timeout);
    }

    const contentType = (response.headers.get("content-type") ?? "").split(";", 1)[0]?.trim().toLowerCase() ?? "";
    const location = response.headers.get("location");
    const redirectHost = safeHttpsHostname(location, url);
    let formActionHost: string | null = null;
    let formMethod: string | null = null;
    if (contentType === "text/html" || contentType === "application/xhtml+xml") {
      const html = await readLimitedText(response, 1_048_576);
      const formTag = /<form\b[^>]*>/i.exec(html)?.[0];
      if (formTag) {
        const action = /\baction\s*=\s*["']([^"']+)["']/i.exec(formTag)?.[1];
        formActionHost = safeHttpsHostname(action ?? null, url);
        formMethod = /\bmethod\s*=\s*["']([^"']+)["']/i.exec(formTag)?.[1]?.toUpperCase() ?? "GET";
      }
    } else {
      await response.body?.cancel();
    }
    return { httpStatus: response.status, contentType, redirectHost, formActionHost, formMethod };
  }

  async inspectLtiFormSubmission(value: string): Promise<LtiFormSubmissionInspection> {
    const launchUrl = new URL(value, this.baseUrl);
    if (launchUrl.protocol !== "https:" || launchUrl.origin !== this.baseUrl.origin) {
      throw new CanvasError("INVALID_RESPONSE", "외부도구 실행 URL이 허용된 Canvas 호스트가 아닙니다.");
    }
    const launchResponse = await this.fetchImpl(launchUrl, {
      method: "GET",
      headers: { Accept: "text/html,application/xhtml+xml" },
      redirect: "manual",
    });
    const html = await readLimitedText(launchResponse, 1_048_576);
    const formTag = /<form\b[^>]*>/i.exec(html)?.[0];
    if (!formTag) throw new CanvasError("INVALID_RESPONSE", "외부도구 실행 폼을 찾을 수 없습니다.");
    const method = /\bmethod\s*=\s*["']([^"']+)["']/i.exec(formTag)?.[1]?.toUpperCase() ?? "GET";
    const actionValue = /\baction\s*=\s*["']([^"']+)["']/i.exec(formTag)?.[1];
    if (method !== "POST" || !actionValue) throw new CanvasError("INVALID_RESPONSE", "외부도구 실행 폼이 허용된 POST 형식이 아닙니다.");
    const actionUrl = new URL(decodeHtmlAttribute(actionValue), launchUrl);
    if (actionUrl.protocol !== "https:" || actionUrl.origin !== this.baseUrl.origin) {
      throw new CanvasError("INVALID_RESPONSE", "외부도구 실행 폼 대상이 허용된 Canvas 호스트가 아닙니다.");
    }
    const body = new URLSearchParams();
    for (const match of html.matchAll(/<input\b[^>]*>/gi)) {
      const tag = match[0];
      const name = /\bname\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
      if (!name) continue;
      const inputType = /\btype\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase() ?? "text";
      if (inputType !== "hidden") continue;
      const inputValue = /\bvalue\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] ?? "";
      body.append(decodeHtmlAttribute(name), decodeHtmlAttribute(inputValue));
    }
    if ([...body.keys()].length === 0) throw new CanvasError("INVALID_RESPONSE", "외부도구 실행 폼에 인증 필드가 없습니다.");
    const response = await this.fetchImpl(actionUrl, {
      method: "POST",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      redirect: "manual",
    });
    const contentType = (response.headers.get("content-type") ?? "").split(";", 1)[0]?.trim().toLowerCase() ?? "";
    const redirectHost = safeHttpsHostname(response.headers.get("location"), actionUrl);
    const setsCookie = response.headers.has("set-cookie");
    let anchorCount = 0;
    let pdfLinkCount = 0;
    let downloadLinkCount = 0;
    let iframeCount = 0;
    let formCount = 0;
    let hiddenInputCount = 0;
    let scriptCount = 0;
    let externalScriptCount = 0;
    let inlineScriptCount = 0;
    let jsonScriptCount = 0;
    const scriptSourceHosts = new Set<string>();
    let metaRefreshCount = 0;
    let nextFormActionHost: string | null = null;
    let nextFormMethod: string | null = null;
    if (contentType === "text/html" || contentType === "application/xhtml+xml") {
      const responseHtml = await readLimitedText(response, 2_097_152);
      for (const match of responseHtml.matchAll(/<a\b[^>]*>/gi)) {
        anchorCount += 1;
        const tag = match[0];
        if (/\bdownload(?:\s|=|>)/i.test(tag)) downloadLinkCount += 1;
        const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
        if (!href) continue;
        try {
          const linkUrl = new URL(decodeHtmlAttribute(href), actionUrl);
          if (linkUrl.protocol === "https:" && linkUrl.pathname.toLowerCase().endsWith(".pdf")) pdfLinkCount += 1;
        } catch {
          // Invalid link values are ignored; raw values are never recorded.
        }
      }
      iframeCount = [...responseHtml.matchAll(/<iframe\b[^>]*>/gi)].length;
      const responseForms = [...responseHtml.matchAll(/<form\b[^>]*>/gi)];
      formCount = responseForms.length;
      hiddenInputCount = [...responseHtml.matchAll(/<input\b[^>]*\btype\s*=\s*["']hidden["'][^>]*>/gi)].length;
      const scripts = [...responseHtml.matchAll(/<script\b[^>]*>/gi)];
      scriptCount = scripts.length;
      for (const script of scripts) {
        const tag = script[0];
        const source = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
        if (source) {
          externalScriptCount += 1;
          const host = safeHttpsHostname(decodeHtmlAttribute(source), actionUrl);
          if (host) scriptSourceHosts.add(host);
        } else {
          inlineScriptCount += 1;
        }
        const type = /\btype\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
        if (type === "application/json" || type === "application/ld+json") jsonScriptCount += 1;
      }
      metaRefreshCount = [...responseHtml.matchAll(/<meta\b[^>]*http-equiv\s*=\s*["']refresh["'][^>]*>/gi)].length;
      const nextFormTag = responseForms[0]?.[0];
      if (nextFormTag) {
        const nextAction = /\baction\s*=\s*["']([^"']+)["']/i.exec(nextFormTag)?.[1];
        nextFormActionHost = safeHttpsHostname(nextAction ? decodeHtmlAttribute(nextAction) : null, actionUrl);
        nextFormMethod = /\bmethod\s*=\s*["']([^"']+)["']/i.exec(nextFormTag)?.[1]?.toUpperCase() ?? "GET";
      }
    } else {
      await response.body?.cancel();
    }
    return {
      httpStatus: response.status,
      contentType,
      redirectHost,
      setsCookie,
      anchorCount,
      pdfLinkCount,
      downloadLinkCount,
      iframeCount,
      formCount,
      hiddenInputCount,
      scriptCount,
      externalScriptCount,
      inlineScriptCount,
      jsonScriptCount,
      scriptSourceHosts: [...scriptSourceHosts].sort(),
      metaRefreshCount,
      nextFormActionHost,
      nextFormMethod,
    };
  }

  async getAllPages<T>(path: string, query: Query = {}, maxPages = 10): Promise<CanvasPage<T>> {
    const initialQuery = { ...query, per_page: 100 };
    let nextUrl: URL | undefined = this.buildApiUrl(path, initialQuery);
    const items: T[] = [];
    let pageCount = 0;
    let hadLinkHeader = false;

    while (nextUrl && pageCount < maxPages) {
      const response: JsonResponse<unknown> = await this.requestJson<unknown>(nextUrl);
      if (!Array.isArray(response.data)) {
        throw new CanvasError("INVALID_RESPONSE", "Canvas 목록 응답이 배열이 아닙니다.");
      }
      items.push(...(response.data as T[]));
      pageCount += 1;

      const linkHeader = response.headers.get("link");
      hadLinkHeader ||= linkHeader !== null;
      const next = parseLinkHeader(linkHeader).get("next");
      nextUrl = next ? validateNextPageUrl(next, this.baseUrl.toString()) : undefined;
    }

    return { items, pageCount, hadLinkHeader, truncated: nextUrl !== undefined };
  }

  private buildApiUrl(path: string, query: Query): URL {
    if (!path.startsWith("/api/v1/")) {
      throw new CanvasError("INVALID_RESPONSE", "Canvas API 경로는 /api/v1/로 시작해야 합니다.");
    }
    const url = new URL(path, this.baseUrl);
    if (url.origin !== this.baseUrl.origin) {
      throw new CanvasError("INVALID_RESPONSE", "Canvas 호스트 밖으로 요청할 수 없습니다.");
    }
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) continue;
      if (typeof value === "object") {
        for (const item of value) url.searchParams.append(key, item);
      } else {
        url.searchParams.set(key, String(value));
      }
    }
    return url;
  }

  private async requestJson<T>(initialUrl: URL): Promise<JsonResponse<T>> {
    let url = initialUrl;
    let redirectCount = 0;
    let rateLimitRetries = 0;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${this.options.accessToken}`,
          },
          redirect: "manual",
          signal: controller.signal,
        });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new CanvasError("UPSTREAM_TIMEOUT", "Canvas API 요청 시간이 초과되었습니다.");
        }
        throw new CanvasError("UPSTREAM_ERROR", "Canvas API에 연결할 수 없습니다.");
      } finally {
        clearTimeout(timeout);
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location || redirectCount >= 3) {
          throw new CanvasError("INVALID_RESPONSE", "Canvas 리다이렉트를 안전하게 처리할 수 없습니다.", response.status);
        }
        const redirectUrl = new URL(location, url);
        if (redirectUrl.origin !== this.baseUrl.origin || !redirectUrl.pathname.startsWith("/api/v1/")) {
          throw new CanvasError("INVALID_RESPONSE", "Canvas 인증 요청이 다른 호스트로 리다이렉트되었습니다.", response.status);
        }
        url = redirectUrl;
        redirectCount += 1;
        continue;
      }

      if (response.status === 429 && rateLimitRetries < 2) {
        rateLimitRetries += 1;
        await wait(retryAfterMilliseconds(response.headers.get("retry-after")));
        continue;
      }
      if (!response.ok) throw errorFromStatus(response.status);
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.toLowerCase().includes("application/json")) {
        throw new CanvasError("INVALID_RESPONSE", "Canvas가 JSON이 아닌 응답을 반환했습니다.", response.status);
      }
      try {
        const data = (await response.json()) as T;
        return { data, headers: response.headers, url };
      } catch {
        throw new CanvasError("INVALID_RESPONSE", "Canvas JSON 응답을 해석할 수 없습니다.", response.status);
      }
    }
    throw new CanvasError("INVALID_RESPONSE", "Canvas 리다이렉트 제한을 초과했습니다.");
  }
}

function retryAfterMilliseconds(value: string | null): number {
  if (!value) return 1_000;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, 30_000);
  const date = Date.parse(value);
  if (Number.isNaN(date)) return 1_000;
  return Math.min(Math.max(date - Date.now(), 0), 30_000);
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function safeHttpsHostname(value: string | null, baseUrl: URL): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, baseUrl);
    return url.protocol === "https:" ? url.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)));
}

async function readLimitedText(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let result = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > maxBytes) throw new CanvasError("INVALID_RESPONSE", "외부도구 실행 응답이 허용된 크기를 초과했습니다.");
      result += decoder.decode(chunk.value, { stream: true });
    }
    result += decoder.decode();
    return result;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
