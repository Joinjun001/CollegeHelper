import { App } from "@modelcontextprotocol/ext-apps/app-with-deps";

const root = document.getElementById("root");
if (!root) throw new Error("PDF page image root element is missing.");

const app = new App({ name: "CollegeHelper PDF page viewer", version: "1.0.0" });

app.ontoolresult = (result) => {
  const image = result.content?.find((item) => item.type === "image" && item.mimeType === "image/png");
  if (!image || image.type !== "image" || !/^[A-Za-z0-9+/=]+$/.test(image.data)) {
    root.replaceChildren(statusElement("PDF 페이지 이미지를 표시하지 못했습니다."));
    return;
  }

  const metadata = isRecord(result.structuredContent) ? result.structuredContent : {};
  const title = typeof metadata["title"] === "string" ? metadata["title"] : "강의자료";
  const page = positiveInteger(metadata["page"]) ?? "?";
  const pageCount = positiveInteger(metadata["pageCount"]) ?? "?";
  const dpi = positiveInteger(metadata["dpi"]);
  const figure = document.createElement("figure");
  const element = document.createElement("img");
  element.alt = `${title} PDF ${page}페이지`;
  element.src = `data:image/png;base64,${image.data}`;
  const caption = document.createElement("figcaption");
  caption.textContent = `${title} · ${page}/${pageCount}페이지${dpi ? ` · ${dpi} DPI` : ""}`;
  figure.append(element, caption);
  root.replaceChildren(figure);
};

app.ontoolcancelled = () => {
  root.replaceChildren(statusElement("PDF 페이지 이미지 요청이 취소되었습니다."));
};

await app.connect();

function statusElement(message: string): HTMLDivElement {
  const element = document.createElement("div");
  element.className = "status";
  element.textContent = message;
  return element;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}
