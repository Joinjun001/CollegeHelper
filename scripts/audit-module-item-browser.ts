import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { chromium } from "playwright";
import { z } from "zod";

import { CanvasClient } from "../src/canvas/client.js";
import { loadConfig } from "../src/config.js";

const execFileAsync = promisify(execFile);
const IdSchema = z.string().regex(/^\d+$/);

async function main(): Promise<void> {
  const config = loadConfig();
  const courseId = IdSchema.parse(process.env["AUDIT_COURSE_ID"]);
  const moduleItemId = IdSchema.parse(process.env["AUDIT_MODULE_ITEM_ID"]);
  const client = new CanvasClient({
    baseUrl: config.canvasBaseUrl,
    accessToken: config.canvasAccessToken,
    timeoutMs: config.requestTimeoutMs,
  });
  const launch = await client.getJson<Record<string, unknown>>(
    `/api/v1/courses/${encodeURIComponent(courseId)}/external_tools/sessionless_launch`,
    { launch_type: "module_item", module_item_id: moduleItemId },
  );
  if (typeof launch["url"] !== "string") throw new Error("module item launch URL is unavailable");
  const canvasOrigin = new URL(config.canvasBaseUrl).origin;
  const launchUrl = new URL(launch["url"]);
  if (launchUrl.protocol !== "https:" || launchUrl.origin !== canvasOrigin) {
    throw new Error("module item launch URL is outside the Canvas origin");
  }

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  const temporaryDir = await mkdtemp(join(tmpdir(), "college-helper-module-audit-"));
  try {
    let allowedHandshake = false;
    let blockedWriteCount = 0;
    await page.route("**/*", async (route) => {
      const request = route.request();
      if (request.method() === "GET") {
        await route.continue();
        return;
      }
      const requestUrl = new URL(request.url());
      if (!allowedHandshake && request.method() === "POST" && request.isNavigationRequest()
        && requestUrl.protocol === "https:" && requestUrl.origin === canvasOrigin) {
        allowedHandshake = true;
        await route.continue();
        return;
      }
      blockedWriteCount += 1;
      await route.abort("blockedbyclient");
    });

    const pdfResponsePromise = page.waitForResponse((response) => {
      try {
        const url = new URL(response.url());
        return response.request().method() === "GET"
          && url.protocol === "https:"
          && url.hostname === "hycms.hanyang.ac.kr"
          && url.pathname.endsWith("/original.pdf");
      } catch {
        return false;
      }
    }, { timeout: 45_000 });
    await page.goto(launchUrl.toString(), { waitUntil: "domcontentloaded", timeout: 30_000 });
    const pdfResponse = await pdfResponsePromise;
    const contentType = (pdfResponse.headers()["content-type"] ?? "").split(";", 1)[0]?.trim().toLowerCase() ?? "";
    const pdfUrl = new URL(pdfResponse.url());
    const download = await context.request.get(pdfUrl.toString(), { failOnStatusCode: false, timeout: 60_000 });
    const body = await download.body();
    let extractedTextChars = 0;
    if (download.status() === 200 && contentType === "application/pdf" && body.subarray(0, 5).toString("ascii") === "%PDF-") {
      const pdfPath = join(temporaryDir, "source.pdf");
      const textPath = join(temporaryDir, "source.txt");
      await writeFile(pdfPath, body, { mode: 0o600 });
      await execFileAsync("pdftotext", ["-layout", "-enc", "UTF-8", pdfPath, textPath], { timeout: 60_000 });
      extractedTextChars = (await readFile(textPath, "utf8")).replace(/\0/g, "").trim().length;
    }
    process.stdout.write(`${JSON.stringify({
      schemaVersion: 1,
      readOnly: true,
      sessionlessLaunchSupported: true,
      allowedLtiHandshakePost: allowedHandshake,
      blockedWriteCount,
      pdf: {
        host: pdfUrl.hostname,
        pathPattern: pdfUrl.pathname.endsWith("/original.pdf") ? "*/original.pdf" : "other",
        status: download.status(),
        contentType,
        bytes: body.length,
        validPdfSignature: body.subarray(0, 5).toString("ascii") === "%PDF-",
        extractedTextChars,
      },
    }, null, 2)}\n`);
  } finally {
    await rm(temporaryDir, { recursive: true, force: true });
    await context.close();
    await browser.close();
  }
}

await main();
