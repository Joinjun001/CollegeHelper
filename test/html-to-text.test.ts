import { describe, expect, it } from "vitest";

import { htmlToPlainText } from "../src/security/html-to-text.js";

describe("htmlToPlainText", () => {
  it("removes executable markup and keeps readable text", () => {
    expect(htmlToPlainText('<p>과제 &amp; 안내</p><script>alert("ignore")</script><div>마감</div>'))
      .toBe("과제 & 안내\n마감");
  });

  it("limits untrusted content length", () => {
    expect(htmlToPlainText("가".repeat(20), 10)).toBe(`${"가".repeat(10)}…`);
  });
});
