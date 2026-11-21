import { describe, it, expect, vi } from "vitest";
import { SyncAuthError } from "@hicya/sync/client";

import { InboxKeyChangedError } from "../inbox";
import { ProxyFetchError } from "../proxy";
import { SyncPushError } from "../sync-push";
import {
  badgeForOutcome,
  isSaveableUrl,
  linkOnlyRecord,
  performSave,
  toastForOutcome,
} from "../save";

import type { CaptureArticleResponse, CaptureArticleSuccess } from "../messaging";
import type { ProxyPage } from "../proxy";
import type { SaveDeps } from "../save";
import type { ArticleRecord } from "../sync-push";

const ARTICLE: CaptureArticleSuccess = {
  title: "Notes on a Quiet Harbour",
  author: "A. Writer",
  siteName: "example.org",
  excerpt: "Boats at rest.",
  content: "<p>Boats at rest.</p>",
  textContent: "Boats at rest.",
  wordCount: 3,
  estimatedReadTime: 1,
  url: "https://example.org/harbour",
};

function makeDeps(overrides: Partial<SaveDeps> = {}) {
  const pushed: unknown[] = [];
  const deps = {
    getToken: vi.fn<() => Promise<string | null>>().mockResolvedValue("token"),
    captureTab: vi
      .fn<(tabId: number) => Promise<CaptureArticleResponse>>()
      .mockResolvedValue(ARTICLE),
    parseHtmlInTab: vi
      .fn<(tabId: number, html: string, url: string) => Promise<CaptureArticleResponse>>()
      .mockImplementation((_tabId, _html, url) => Promise.resolve({ ...ARTICLE, url })),
    fetchPage: vi.fn<(token: string, url: string) => Promise<ProxyPage>>().mockResolvedValue({
      html: "<html><body><article>Text</article></body></html>",
      contentType: "text/html; charset=utf-8",
      finalUrl: "https://example.org/final",
    }),
    push: vi
      .fn<(token: string, article: ArticleRecord) => Promise<unknown>>()
      .mockImplementation((_token, article) => {
        pushed.push(article);
        return Promise.resolve({ accepted: 1 });
      }),
    onProgress: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    ...overrides,
  };
  return { deps, pushed };
}

describe("isSaveableUrl", () => {
  it("accepts only http and https URLs", () => {
    expect(isSaveableUrl("https://example.org/a")).toBe(true);
    expect(isSaveableUrl("http://example.org/a")).toBe(true);
    expect(isSaveableUrl("chrome://extensions")).toBe(false);
    expect(isSaveableUrl("about:blank")).toBe(false);
    expect(isSaveableUrl("file:///Users/me/a.html")).toBe(false);
    expect(isSaveableUrl("not a url")).toBe(false);
    expect(isSaveableUrl(undefined)).toBe(false);
  });
});

describe("performSave: page", () => {
  it("captures the tab and pushes the parsed article", async () => {
    const { deps, pushed } = makeDeps();
    const outcome = await performSave(
      { kind: "page", tabId: 7, tabUrl: "https://example.org/harbour" },
      deps,
    );

    expect(outcome).toEqual({ status: "saved", title: ARTICLE.title, withContent: true });
    expect(deps.captureTab).toHaveBeenCalledWith(7);
    expect(deps.onProgress).toHaveBeenCalledOnce();
    expect(deps.fetchPage).not.toHaveBeenCalled();
    expect(pushed[0]).toMatchObject({
      url: ARTICLE.url,
      title: ARTICLE.title,
      content: ARTICLE.content,
      status: "inbox",
    });
  });

  it("does nothing on browser pages", async () => {
    const { deps } = makeDeps();
    const outcome = await performSave({ kind: "page", tabId: 1, tabUrl: "chrome://newtab" }, deps);
    expect(outcome).toEqual({ status: "unsupported" });
    expect(deps.getToken).not.toHaveBeenCalled();
    expect(deps.captureTab).not.toHaveBeenCalled();
  });

  it("stops before reading the page when sign-in is declined", async () => {
    const { deps } = makeDeps({ getToken: () => Promise.resolve(null) });
    const outcome = await performSave(
      { kind: "page", tabId: 1, tabUrl: "https://example.org/" },
      deps,
    );
    expect(outcome).toEqual({ status: "signed-out" });
    expect(deps.captureTab).not.toHaveBeenCalled();
    expect(deps.push).not.toHaveBeenCalled();
  });

  it("keeps the link when no article can be found", async () => {
    const { deps, pushed } = makeDeps({
      captureTab: () => Promise.resolve({ error: "Could not find an article on this page" }),
    });
    const outcome = await performSave(
      { kind: "page", tabId: 1, tabUrl: "https://example.org/app", tabTitle: "Dashboard" },
      deps,
    );
    expect(outcome).toEqual({ status: "saved", title: "Dashboard", withContent: false });
    expect(pushed[0]).toMatchObject({ url: "https://example.org/app", content: null });
  });

  it("reports an expired session from the sync service as signed out", async () => {
    const { deps } = makeDeps({
      push: () => Promise.reject(new SyncPushError("Authentication expired", 401)),
    });
    const outcome = await performSave(
      { kind: "page", tabId: 1, tabUrl: "https://example.org/" },
      deps,
    );
    expect(outcome).toEqual({ status: "signed-out" });
  });

  it("reads a 401 while fetching the inbox key as signed out", async () => {
    const { deps } = makeDeps({ push: () => Promise.reject(new SyncAuthError()) });
    const outcome = await performSave({ kind: "page", tabId: 1, tabUrl: ARTICLE.url }, deps);
    expect(outcome).toEqual({ status: "signed-out" });
  });

  it("refuses to save when the account's inbox key changed", async () => {
    const { deps } = makeDeps({ push: () => Promise.reject(new InboxKeyChangedError()) });
    const outcome = await performSave({ kind: "page", tabId: 1, tabUrl: ARTICLE.url }, deps);
    expect(outcome).toEqual({ status: "key-changed" });
    expect(toastForOutcome(outcome)?.tone).toBe("error");
    expect(badgeForOutcome(outcome).text).toBe("!");
  });

  it("reports other push failures", async () => {
    const { deps } = makeDeps({ push: () => Promise.reject(new TypeError("Failed to fetch")) });
    const outcome = await performSave(
      { kind: "page", tabId: 1, tabUrl: "https://example.org/" },
      deps,
    );
    expect(outcome).toEqual({ status: "failed" });
  });
});

describe("performSave: link", () => {
  const request = {
    kind: "link" as const,
    tabId: 3,
    linkUrl: "https://example.org/short",
    linkText: "A linked essay",
  };

  it("fetches through the proxy and parses in the current tab", async () => {
    const { deps, pushed } = makeDeps();
    const outcome = await performSave(request, deps);

    expect(deps.fetchPage).toHaveBeenCalledWith("token", "https://example.org/short");
    expect(deps.parseHtmlInTab).toHaveBeenCalledWith(
      3,
      "<html><body><article>Text</article></body></html>",
      "https://example.org/final",
    );
    expect(deps.captureTab).not.toHaveBeenCalled();
    expect(outcome).toEqual({ status: "saved", title: ARTICLE.title, withContent: true });
    expect(pushed[0]).toMatchObject({ url: "https://example.org/final", content: ARTICLE.content });
  });

  it("saves the link itself when the proxy fails", async () => {
    const { deps, pushed } = makeDeps({
      fetchPage: () => Promise.reject(new Error("Proxy fetch failed: 502")),
    });
    const outcome = await performSave(request, deps);
    expect(outcome).toEqual({ status: "saved", title: "A linked essay", withContent: false });
    expect(deps.parseHtmlInTab).not.toHaveBeenCalled();
    expect(pushed[0]).toMatchObject({
      url: request.linkUrl,
      content: null,
      site_name: "example.org",
    });
  });

  it("saves the link itself for non-HTML responses", async () => {
    const { deps } = makeDeps({
      fetchPage: () =>
        Promise.resolve({
          html: "%PDF",
          contentType: "application/pdf",
          finalUrl: request.linkUrl,
        }),
    });
    const outcome = await performSave(request, deps);
    expect(outcome).toMatchObject({ status: "saved", withContent: false });
    expect(deps.parseHtmlInTab).not.toHaveBeenCalled();
  });

  it("saves the link itself when parsing fails", async () => {
    const { deps } = makeDeps({
      parseHtmlInTab: () => Promise.resolve({ error: "Could not find an article on this page" }),
    });
    const outcome = await performSave(request, deps);
    expect(outcome).toMatchObject({ status: "saved", withContent: false });
  });

  describe("http links", () => {
    const httpRequest = { ...request, linkUrl: "http://example.org/short" };

    it("fetches the https URL and records the secure address", async () => {
      const { deps, pushed } = makeDeps({
        fetchPage: vi.fn<(token: string, url: string) => Promise<ProxyPage>>().mockResolvedValue({
          html: "<html><body><article>Text</article></body></html>",
          contentType: "text/html",
          finalUrl: "https://example.org/short",
        }),
      });
      const outcome = await performSave(httpRequest, deps);
      expect(deps.fetchPage).toHaveBeenCalledTimes(1);
      expect(deps.fetchPage).toHaveBeenCalledWith("token", "https://example.org/short");
      expect(outcome).toEqual({ status: "saved", title: ARTICLE.title, withContent: true });
      expect(pushed[0]).toMatchObject({ url: "https://example.org/short" });
    });

    it("never records a redirect back to plain http", async () => {
      const { deps, pushed } = makeDeps({
        fetchPage: () =>
          Promise.resolve({
            html: "<html></html>",
            contentType: "text/html",
            finalUrl: "http://example.org/elsewhere",
          }),
      });
      await performSave(httpRequest, deps);
      expect(pushed[0]).toMatchObject({ url: "https://example.org/short" });
    });

    it.each([502, 504])(
      "reports insecure-only without saving when the https fetch fails (%i)",
      async (status) => {
        const fetchPage = vi
          .fn<(token: string, url: string) => Promise<ProxyPage>>()
          .mockRejectedValue(new ProxyFetchError(`Proxy fetch failed: ${String(status)}`, status));
        const { deps, pushed } = makeDeps({ fetchPage });
        const outcome = await performSave(httpRequest, deps);
        expect(outcome).toEqual({ status: "insecure-only" });
        expect(fetchPage).toHaveBeenCalledTimes(1);
        expect(fetchPage).toHaveBeenCalledWith("token", "https://example.org/short");
        expect(pushed).toHaveLength(0);
        expect(toastForOutcome(outcome)).toEqual({
          tone: "error",
          title: "This page isn't available over a secure connection",
        });
        expect(badgeForOutcome(outcome).text).toBe("!");
      },
    );

    it("keeps the link-only fallback for https links the proxy can't fetch", async () => {
      const { deps } = makeDeps({
        fetchPage: () => Promise.reject(new ProxyFetchError("Proxy fetch failed: 502", 502)),
      });
      const outcome = await performSave(request, deps);
      expect(outcome).toMatchObject({ status: "saved", withContent: false });
    });

    it("sends loopback http links unchanged", async () => {
      const { deps } = makeDeps();
      await performSave({ ...request, linkUrl: "http://localhost:8766/a" }, deps);
      expect(deps.fetchPage).toHaveBeenCalledWith("token", "http://localhost:8766/a");
    });
  });

  it("ignores links that are not web pages", async () => {
    const { deps } = makeDeps();
    const outcome = await performSave({ ...request, linkUrl: "mailto:someone@example.org" }, deps);
    expect(outcome).toEqual({ status: "unsupported" });
  });
});

describe("linkOnlyRecord", () => {
  it("falls back to the hostname for a title", () => {
    const record = linkOnlyRecord("https://www.example.org/a", "   ");
    expect(record.title).toBe("example.org");
    expect(record.word_count).toBe(0);
    expect(record.content).toBeNull();
  });
});

describe("feedback", () => {
  it("describes each outcome", () => {
    expect(toastForOutcome({ status: "saved", title: "T", withContent: true })).toEqual({
      tone: "success",
      title: "Saved to Alcove",
      detail: "T",
    });
    expect(toastForOutcome({ status: "saved", title: "T", withContent: false })?.title).toBe(
      "Link saved to Alcove",
    );
    expect(toastForOutcome({ status: "signed-out" })?.tone).toBe("error");
    expect(toastForOutcome({ status: "failed" })?.tone).toBe("error");
    expect(toastForOutcome({ status: "unsupported" })).toBeNull();
  });

  it("picks badge text", () => {
    expect(badgeForOutcome({ status: "saved", title: "T", withContent: true }).text).toBe("✓");
    expect(badgeForOutcome({ status: "failed" }).text).toBe("!");
  });
});
