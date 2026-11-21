/**
 * Article capture with Readability. Runs inside the page (isolated world) after the
 * background script injects `capture.js` on a user action. Never runs on its own.
 */

import { Readability } from "@mozilla/readability";
import { countWords, estimateReadTime } from "@hicya/alcove-shared/lib";

import type { CaptureArticleResponse } from "./messaging";

export interface AlcoveCaptureApi {
  /** Parse the document the user is looking at. */
  captureDocument: () => CaptureArticleResponse;
  /** Parse HTML fetched for a link (never attached to the page, scripts never run). */
  parseHtml: (html: string, url: string) => CaptureArticleResponse;
}

declare global {
  // Set by capture.js in the page's isolated world; read by later executeScript calls.
  var alcoveCapture: AlcoveCaptureApi | undefined;
}

export function extractHostname(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Run Readability on a document the caller owns (it is modified in place). */
export function parseDocument(doc: Document, url: string): CaptureArticleResponse {
  if (!doc.querySelector("base") && doc.head) {
    const base = doc.createElement("base");
    base.href = url;
    doc.head.prepend(base);
  }

  const result = new Readability(doc).parse();
  if (!result || !result.content) {
    return { error: "Could not find an article on this page" };
  }

  const textContent = result.textContent ?? "";
  const wordCount = countWords(textContent);
  const title = result.title?.trim() || doc.title.trim() || extractHostname(url) || url;

  return {
    title,
    author: result.byline ?? null,
    siteName: result.siteName ?? extractHostname(url),
    excerpt: result.excerpt ?? null,
    content: result.content,
    textContent,
    wordCount,
    estimatedReadTime: estimateReadTime(wordCount),
    url,
  };
}

function cloneDocument(source: Document): Document {
  const clone = source.cloneNode(true);
  if (clone instanceof Document) return clone;
  // Not reachable for a Document, but keeps the types honest without a cast.
  return new DOMParser().parseFromString(source.documentElement.outerHTML, "text/html");
}

export function createCaptureApi(): AlcoveCaptureApi {
  return {
    captureDocument() {
      try {
        return parseDocument(cloneDocument(document), location.href);
      } catch (err: unknown) {
        return { error: err instanceof Error ? err.message : "Could not read this page" };
      }
    },
    parseHtml(html, url) {
      try {
        const doc = new DOMParser().parseFromString(html, "text/html");
        return parseDocument(doc, url);
      } catch (err: unknown) {
        return { error: err instanceof Error ? err.message : "Could not read this page" };
      }
    },
  };
}
