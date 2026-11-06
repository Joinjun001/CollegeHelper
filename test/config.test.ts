import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("유효한 환경변수를 정규화한다", () => {
    const config = loadConfig({
      CANVAS_BASE_URL: "https://canvas.example.edu/",
      CANVAS_ACCESS_TOKEN: "local-secret",
    });
    expect(config.canvasBaseUrl).toBe("https://canvas.example.edu");
    expect(config.auditMaxPages).toBe(10);
  });

  it("HTTPS가 아닌 주소를 거부하고 토큰값을 오류에 노출하지 않는다", () => {
    const secret = "do-not-print-this-token";
    expect(() => loadConfig({ CANVAS_BASE_URL: "http://canvas.example.edu", CANVAS_ACCESS_TOKEN: secret }))
      .toThrow(ConfigError);
    try {
      loadConfig({ CANVAS_BASE_URL: "http://canvas.example.edu", CANVAS_ACCESS_TOKEN: secret });
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });
});
