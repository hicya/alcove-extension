/**
 * Save orchestration, independent of the chrome.* APIs so it can be unit tested.
 *
 * Page save: inject capture.js into the active tab and parse the live DOM.
 * Link save: fetch the link through the sync service proxy, then parse the HTML in a
 * detached document inside the active tab (the tab the user right-clicked in, which the
 * context menu click grants through activeTab). If the link can't be fetched or parsed,
 * Alcove still saves it as a link (URL + title, no content), the same metadata-only shape
 * the apps already know from imports.
 */

import {
  INSECURE_ONLY_MESSAGE,
  isProxyUpstreamFailure,
  secureFetchTarget,
  secureFetchUrl,
} from "@hicya/alcove-shared/lib";
import { SyncAuthError } from "@hicya/sync/client";

import { extractHostname } from "./capture";
import { InboxKeyChangedError } from "./inbox";
import { isCaptureError } from "./messaging";
import { isHtmlContentType, ProxyFetchError } from "./proxy";
import { buildArticleRecord, SyncPausedError, SyncPushError } from "./sync-push";

import type { CaptureArticleResponse, CaptureArticleSuccess } from "./messaging";
import type { ProxyPage } from "./proxy";
import type { ArticleRecord, SyncPauseReason } from "./sync-push";
import type { ToastMessage } from "./toast";

export type SaveRequest =
  | { kind: "page"; tabId: number; tabUrl: string | undefined; tabTitle?: string }
  | { kind: "link"; tabId: number; linkUrl: string; linkText?: string };

export type SaveOutcome =
  | { status: "saved"; title: string; withContent: boolean }
  | { status: "unsupported" }
  | { status: "signed-out" }
  | { status: "paused"; reason: SyncPauseReason; retryAfterSeconds: number | null }
  /** The account's inbox key differs from the one this browser pinned; nothing was sent. */
  | { status: "key-changed" }
  /** An http link whose https form couldn't be fetched; Alcove never fetches plain http. */
  | { status: "insecure-only" }
  | { status: "failed" };

export interface SaveDeps {
  /** A valid access token, signing in interactively when needed. Null if the user declines. */
  getToken: () => Promise<string | null>;
  captureTab: (tabId: number) => Promise<CaptureArticleResponse>;
  parseHtmlInTab: (tabId: number, html: string, url: string) => Promise<CaptureArticleResponse>;
  fetchPage: (token: string, url: string) => Promise<ProxyPage>;
  /** Seals the article to the account's inbox and pushes it (pushSealedArticle). */
  push: (token: string, article: ArticleRecord) => Promise<unknown>;
  /** Called once the user is signed in and the save is under way. */
  onProgress?: () => Promise<void>;
}

export function isSaveableUrl(url: string | undefined): url is string {
  if (!url) return false;
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function recordFromCapture(article: CaptureArticleSuccess): ArticleRecord {
  return buildArticleRecord({
    url: article.url,
    title: article.title,
    author: article.author,
    siteName: article.siteName,
    excerpt: article.excerpt,
    content: article.content,
    wordCount: article.wordCount,
    estimatedReadTime: article.estimatedReadTime,
  });
}

/** A link-only record. The apps treat null content like a metadata-only import. */
export function linkOnlyRecord(url: string, title: string | undefined): ArticleRecord {
  const host = extractHostname(url);
  return buildArticleRecord({
    url,
    title: title?.trim() || host || url,
    author: null,
    siteName: host,
    excerpt: null,
    content: null,
    wordCount: 0,
    estimatedReadTime: 0,
  });
}

async function articleForLink(
  request: Extract<SaveRequest, { kind: "link" }>,
  token: string,
  deps: SaveDeps,
): Promise<ArticleRecord | "insecure-only"> {
  // Non-loopback http links are only ever fetched over https, with no http fallback.
  const target = secureFetchTarget(request.linkUrl);
  try {
    const page = await deps.fetchPage(token, target.url);
    if (isHtmlContentType(page.contentType)) {
      const securedFinal =
        isSaveableUrl(page.finalUrl) && secureFetchUrl(page.finalUrl) === page.finalUrl;
      const url = securedFinal ? page.finalUrl : target.url;
      const parsed = await deps.parseHtmlInTab(request.tabId, page.html, url);
      if (!isCaptureError(parsed)) return recordFromCapture(parsed);
    }
    // The secure page answered but couldn't be read: keep the secure address.
    return linkOnlyRecord(target.url, request.linkText);
  } catch (err: unknown) {
    if (target.upgraded && err instanceof ProxyFetchError && isProxyUpstreamFailure(err.status)) {
      return "insecure-only";
    }
    // Proxy refused or the site is unreachable: fall back to saving the link itself.
  }
  return linkOnlyRecord(request.linkUrl, request.linkText);
}

export async function performSave(request: SaveRequest, deps: SaveDeps): Promise<SaveOutcome> {
  const target = request.kind === "page" ? request.tabUrl : request.linkUrl;
  if (!isSaveableUrl(target)) return { status: "unsupported" };

  const token = await deps.getToken();
  if (!token) return { status: "signed-out" };

  await deps.onProgress?.();

  let article: ArticleRecord;
  if (request.kind === "page") {
    const captured = await deps.captureTab(request.tabId);
    article = isCaptureError(captured)
      ? linkOnlyRecord(target, request.tabTitle)
      : recordFromCapture(captured);
  } else {
    const linked = await articleForLink(request, token, deps);
    if (linked === "insecure-only") return { status: "insecure-only" };
    article = linked;
  }

  try {
    await deps.push(token, article);
  } catch (err: unknown) {
    if (err instanceof SyncPausedError) {
      return { status: "paused", reason: err.reason, retryAfterSeconds: err.retryAfterSeconds };
    }
    if (err instanceof SyncPushError && err.status === 401) return { status: "signed-out" };
    if (err instanceof SyncAuthError) return { status: "signed-out" };
    if (err instanceof InboxKeyChangedError) return { status: "key-changed" };
    return { status: "failed" };
  }

  return { status: "saved", title: article.title, withContent: article.content !== null };
}

// ── Feedback ───────────────────────────────────────────────────────────────

export const PROGRESS_TOAST: ToastMessage = { tone: "progress", title: "Saving to Alcove…" };

export function toastForOutcome(outcome: SaveOutcome): ToastMessage | null {
  switch (outcome.status) {
    case "saved":
      return outcome.withContent
        ? { tone: "success", title: "Saved to Alcove", detail: outcome.title }
        : {
            tone: "success",
            title: "Link saved to Alcove",
            detail: `${outcome.title} — the article text couldn't be read, so Alcove kept the link.`,
          };
    case "signed-out":
      return {
        tone: "error",
        title: "Sign in to save to Alcove",
        detail: "Click the Alcove button in the toolbar to sign in, then save again.",
      };
    case "paused":
      return outcome.reason === "storage_quota_exceeded"
        ? {
            tone: "progress",
            title: "Your Alcove library is full",
            detail:
              "This page wasn't saved. Delete articles you've finished in Alcove, then save it again.",
          }
        : {
            tone: "progress",
            title: "Saving is paused for now",
            detail: `You've saved a lot today. Try again ${retryWhen(outcome.retryAfterSeconds)}.`,
          };
    case "key-changed":
      return {
        tone: "error",
        title: "Couldn't save this page",
        detail: "Sign in again or update the extension.",
      };
    case "insecure-only":
      return { tone: "error", title: INSECURE_ONLY_MESSAGE };
    case "failed":
      return {
        tone: "error",
        title: "Couldn't save to Alcove",
        detail: "Check your connection and try again.",
      };
    case "unsupported":
      return null;
  }
}

export interface BadgeState {
  text: string;
  color: string;
}

export function badgeForOutcome(outcome: SaveOutcome): BadgeState {
  if (outcome.status === "saved") return { text: "✓", color: "#4E8051" };
  if (outcome.status === "paused") return { text: "…", color: "#2D6E73" };
  return { text: "!", color: "#B84A4A" };
}

/** "in about 3 hours", "in about 20 minutes" or "later" when the wait is unknown. */
export function retryWhen(seconds: number | null): string {
  if (!seconds) return "later";
  if (seconds < 90) return "in a minute";
  const minutes = Math.round(seconds / 60);
  if (minutes < 55) return `in about ${String(minutes)} minutes`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? "in about an hour" : `in about ${String(hours)} hours`;
}
