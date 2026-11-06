import { CanvasError } from "./errors.js";

const LINK_PART = /<([^>]+)>\s*;\s*rel="([^"]+)"/g;

export function parseLinkHeader(header: string | null): ReadonlyMap<string, string> {
  const links = new Map<string, string>();
  if (!header) return links;

  for (const match of header.matchAll(LINK_PART)) {
    const url = match[1];
    const relation = match[2];
    if (url && relation) links.set(relation, url);
  }
  return links;
}

export function validateNextPageUrl(next: string, baseUrl: string): URL {
  let url: URL;
  try {
    url = new URL(next, baseUrl);
  } catch {
    throw new CanvasError("INVALID_RESPONSE", "Canvas 페이지네이션 URL이 올바르지 않습니다.");
  }

  const base = new URL(baseUrl);
  if (url.origin !== base.origin || !url.pathname.startsWith("/api/v1/")) {
    throw new CanvasError("INVALID_RESPONSE", "Canvas 페이지네이션이 허용되지 않은 주소를 가리킵니다.");
  }
  return url;
}
