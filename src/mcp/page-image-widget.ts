export const pageImageWidgetUri = "ui://college-helper/pdf-page-image-v1.html";

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
  <script>
    const root = document.getElementById("root");

    function getToolResult() {
      const response = window.openai && window.openai.toolResponseMetadata;
      return (response && (response.mcp_tool_result || response.call_tool_result)) || null;
    }

    function render() {
      const result = getToolResult();
      const image = result && Array.isArray(result.content)
        ? result.content.find((item) => item && item.type === "image" && item.mimeType === "image/png")
        : null;
      if (!image || typeof image.data !== "string" || !/^[A-Za-z0-9+/=]+$/.test(image.data)) return false;

      const meta = result.structuredContent || {};
      const figure = document.createElement("figure");
      const element = document.createElement("img");
      element.alt = typeof meta.title === "string" ? meta.title + " PDF 페이지" : "PDF 페이지";
      element.src = "data:image/png;base64," + image.data;
      const caption = document.createElement("figcaption");
      const page = Number.isInteger(meta.page) ? meta.page : "?";
      const pageCount = Number.isInteger(meta.pageCount) ? meta.pageCount : "?";
      const dpi = Number.isInteger(meta.dpi) ? " · " + meta.dpi + " DPI" : "";
      caption.textContent = (typeof meta.title === "string" ? meta.title : "강의자료") + " · " + page + "/" + pageCount + "페이지" + dpi;
      figure.append(element, caption);
      root.replaceChildren(figure);
      return true;
    }

    render();
    window.addEventListener("openai:set_globals", render);
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (render() || attempts >= 100) clearInterval(timer);
    }, 100);
  </script>
</body>
</html>`;
