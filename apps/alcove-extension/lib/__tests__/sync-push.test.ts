import { describe, it, expect, vi, beforeEach } from "vitest";
import { SyncAuthError } from "@hicya/sync/client";
import { Vault, inboxKeyFromKeyring, isSealedData } from "@hicya/sync/encryption";
import { openInboxRecord } from "@hicya/sync/inbox";

import { InboxKeyChangedError } from "../inbox";
import {
  buildArticleRecord,
  buildSealedSyncPayload,
  pushSealedArticle,
  pushToSync,
  toSyncPushResult,
} from "../sync-push";

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(5)));

function testInboxKey() {
  const key = inboxKeyFromKeyring(Vault.create("alcove", KEY, "key-1").keyringJson);
  if (!key) throw new Error("keyring without inbox key");
  return key;
}

const mockFetch = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>();
vi.stubGlobal("fetch", mockFetch);

describe("buildArticleRecord", () => {
  it("constructs a valid article record", () => {
    const article = buildArticleRecord({
      url: "https://example.com/article",
      title: "Test Article",
      author: "Jane Doe",
      siteName: "example.com",
      excerpt: "A test excerpt",
      content: "<p>Hello</p>",
      wordCount: 1,
      estimatedReadTime: 1,
    });

    expect(article.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(article.url).toBe("https://example.com/article");
    expect(article.title).toBe("Test Article");
    expect(article.author).toBe("Jane Doe");
    expect(article.site_name).toBe("example.com");
    expect(article.excerpt).toBe("A test excerpt");
    expect(article.content).toBe("<p>Hello</p>");
    expect(article.word_count).toBe(1);
    expect(article.estimated_read_time).toBe(1);
    expect(article.status).toBe("inbox");
    expect(article.is_favorite).toBe(0);
    expect(article.reading_progress).toBe(0);
    expect(article.read_at).toBeNull();
    expect(article.deleted_at).toBeNull();
    expect(article.saved_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(article.created_at).toBe(article.saved_at);
    expect(article.updated_at).toBe(article.saved_at);
  });

  it("handles null fields", () => {
    const article = buildArticleRecord({
      url: "https://example.com",
      title: "No Author",
      author: null,
      siteName: null,
      excerpt: null,
      content: null,
      wordCount: 0,
      estimatedReadTime: 1,
    });

    expect(article.author).toBeNull();
    expect(article.site_name).toBeNull();
    expect(article.excerpt).toBeNull();
    expect(article.content).toBeNull();
  });
});

describe("buildSealedSyncPayload", () => {
  it("seals the article to the account's inbox and never pushes it readable", () => {
    const vault = Vault.create("alcove", KEY, "key-1");
    const inboxKey = inboxKeyFromKeyring(vault.keyringJson);
    if (!inboxKey) throw new Error("keyring without inbox key");
    const article = buildArticleRecord({
      url: "https://example.com/private",
      title: "A private title",
      author: null,
      siteName: null,
      excerpt: null,
      content: "<p>private content</p>",
      wordCount: 2,
      estimatedReadTime: 1,
    });
    const payload = buildSealedSyncPayload(article, inboxKey);

    expect(payload.records).toHaveLength(1);
    expect(payload.reviewLogs).toEqual([]);
    const [record] = payload.records;
    expect(record.entityType).toBe("inbox");
    expect(record.entityId).not.toBe(article.id);
    expect(record.deleted).toBe(false);
    expect(isSealedData(record.data)).toBe(true);
    expect(record.data).not.toContain("private");
    expect(record.data).not.toContain("example.com");

    // Only a device with the account key opens it, and it carries the article unchanged.
    const opened = openInboxRecord(vault, record.entityId, record.data);
    expect(opened.entityType).toBe("article");
    expect(opened.entityId).toBe(article.id);
    expect(JSON.parse(opened.data)).toEqual(article);
  });
});

describe("pushSealedArticle", () => {
  const vault = Vault.create("alcove", KEY, "key-1");
  const inboxKey = inboxKeyFromKeyring(vault.keyringJson);

  function pins(initial: Record<string, string> = {}) {
    const stored = { ...initial };
    return {
      stored,
      get: (id: string) => Promise.resolve(stored[id] ?? null),
      set: (id: string, key: string) => {
        stored[id] = key;
        return Promise.resolve();
      },
      clear: () => Promise.resolve(),
    };
  }

  const article = buildArticleRecord({
    url: "https://example.com",
    title: "Pinned",
    author: null,
    siteName: null,
    excerpt: null,
    content: null,
    wordCount: 0,
    estimatedReadTime: 0,
  });

  it("pins the inbox key on first use and pushes only sealed records", async () => {
    if (!inboxKey) throw new Error("keyring without inbox key");
    const store = pins();
    const push = vi.fn(() => Promise.resolve({ accepted: 1 }));
    await pushSealedArticle("token", article, {
      accountId: () => Promise.resolve("user-1"),
      inbox: { pins: store, ensure: () => Promise.resolve(inboxKey) },
      push,
    });
    expect(store.stored).toEqual({ "user-1": inboxKey.publicKey });
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("refuses to push when the server hands out a different inbox key", async () => {
    if (!inboxKey) throw new Error("keyring without inbox key");
    const push = vi.fn(() => Promise.resolve({ accepted: 1 }));
    await expect(
      pushSealedArticle("token", article, {
        accountId: () => Promise.resolve("user-1"),
        inbox: {
          pins: pins({ "user-1": "c29tZXRoaW5nIGVsc2U=" }),
          ensure: () => Promise.resolve(inboxKey),
        },
        push,
      }),
    ).rejects.toBeInstanceOf(InboxKeyChangedError);
    expect(push).not.toHaveBeenCalled();
  });

  it("treats a missing account as signed out", async () => {
    await expect(
      pushSealedArticle("token", article, {
        accountId: () => Promise.resolve(null),
        inbox: { pins: pins() },
      }),
    ).rejects.toBeInstanceOf(SyncAuthError);
  });
});

describe("pushToSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends correct request", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ accepted: 1 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const payload = buildSealedSyncPayload(
      buildArticleRecord({
        url: "https://example.com",
        title: "Test",
        author: null,
        siteName: null,
        excerpt: null,
        content: null,
        wordCount: 0,
        estimatedReadTime: 1,
      }),
      testInboxKey(),
    );

    const result = await pushToSync("test-token", payload);

    expect(result.accepted).toBe(1);

    expect(mockFetch).toHaveBeenCalledWith(
      "https://sync.hicya.org/sync/push",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
          "Content-Type": "application/json",
        }),
      }),
    );
  });

  it("throws on 401 response", async () => {
    mockFetch.mockResolvedValueOnce(new Response("", { status: 401 }));

    const payload = { records: [], reviewLogs: [] as never[] };
    await expect(pushToSync("expired-token", payload)).rejects.toThrow("Authentication expired");
  });

  it("throws on server error", async () => {
    mockFetch.mockResolvedValueOnce(new Response("", { status: 500 }));

    const payload = { records: [], reviewLogs: [] as never[] };
    await expect(pushToSync("token", payload)).rejects.toThrow("Sync push failed: 500");
  });
});

describe("toSyncPushResult", () => {
  it("accepts the sync service response", () => {
    expect(toSyncPushResult({ accepted: 2, mediaNeeded: [] })).toEqual({ accepted: 2 });
  });

  it("rejects an unexpected body", () => {
    expect(() => toSyncPushResult({ ok: true })).toThrow("Unexpected sync response");
    expect(() => toSyncPushResult(null)).toThrow("Unexpected sync response");
  });
});
