import { readFileSync } from "node:fs";
import { join } from "node:path";

export const pageImageWidgetUri = "ui://college-helper/pdf-page-image-v2.html";

const pageImageWidgetScript = readFileSync(join(process.cwd(), "public", "page-image-widget.js"), "utf8");

export const pageImageWidgetHtml = `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    :root { color-scheme: light dark; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; background: transparent; color: var(--color-text-primary, CanvasText); }
    figure { margin: 0; display: grid; gap: 10px; }
    img { display: block; width: 100%; height: auto; max-height: 78vh; object-fit: contain; border-radius: 10px; background: white; }
    figcaption { font-size: 13px; line-height: 1.45; color: var(--color-text-secondary, GrayText); }
    .status { min-height: 72px; display: grid; place-items: center; padding: 20px; color: var(--color-text-secondary, GrayText); }
  </style>
</head>
<body>
  <main id="root"><div class="status">PDF 페이지 이미지를 불러오는 중입니다.</div></main>
  <script type="module">${pageImageWidgetScript}</script>
</body>
</html>`;
