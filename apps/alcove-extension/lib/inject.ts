/**
 * Programmatic injection into the active tab. Every call here relies on the temporary
 * `activeTab` grant that Chrome and Firefox give on a toolbar click, a context menu click
 * or the keyboard shortcut; the extension has no standing access to any website.
 */

import { toCaptureResponse } from "./messaging";
import { renderToast } from "./toast";

import type { CaptureArticleResponse } from "./messaging";
import type { ToastMessage } from "./toast";

/** Output path of `entrypoints/capture.ts` (a WXT unlisted script). */
export const CAPTURE_SCRIPT = "capture.js";

async function ensureCaptureScript(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({ target: { tabId }, files: [CAPTURE_SCRIPT] });
}

function firstResult(results: chrome.scripting.InjectionResult<unknown>[]): unknown {
  return results.length > 0 ? results[0].result : undefined;
}

/** Parse the page currently shown in the tab. */
export async function captureTab(tabId: number): Promise<CaptureArticleResponse> {
  try {
    await ensureCaptureScript(tabId);
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => globalThis.alcoveCapture?.captureDocument() ?? null,
    });
    return toCaptureResponse(firstResult(results));
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : "This page can't be read" };
  }
}

/**
 * Parse HTML fetched for a link, using the tab only as a place where DOMParser and
 * Readability are available. The HTML is parsed into a detached document: it is never
 * attached to the page and its scripts never run.
 */
export async function parseHtmlInTab(
  tabId: number,
  html: string,
  url: string,
): Promise<CaptureArticleResponse> {
  try {
    await ensureCaptureScript(tabId);
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (source: string, pageUrl: string) =>
        globalThis.alcoveCapture?.parseHtml(source, pageUrl) ?? null,
      args: [html, url],
    });
    return toCaptureResponse(firstResult(results));
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : "This page can't be read" };
  }
}

/** Show save feedback in the tab. Failures are ignored: the badge still reports status. */
export async function showToast(tabId: number, message: ToastMessage): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: renderToast,
      args: [message],
    });
  } catch {
    // Restricted page (browser UI, store pages): the badge is the only feedback.
  }
}
