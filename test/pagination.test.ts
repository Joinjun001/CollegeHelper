import { describe, expect, it } from "vitest";
import { CanvasError } from "../src/canvas/errors.js";
import { parseLinkHeader, validateNextPageUrl } from "../src/canvas/pagination.js";

describe("Canvas 페이지네이션", () => {
  it("Link 헤더에서 next 관계를 읽는다", () => {
    const links = parseLinkHeader('<https://canvas.example.edu/api/v1/courses?page=2>; rel="next", <https://canvas.example.edu/api/v1/courses?page=4>; rel="last"');
    expect(links.get("next")).toContain("page=2");
  });

  it("다른 호스트의 next URL을 차단한다", () => {
    expect(() => validateNextPageUrl("https://evil.example/api/v1/courses?page=2", "https://canvas.example.edu"))
      .toThrow(CanvasError);
  });
});
