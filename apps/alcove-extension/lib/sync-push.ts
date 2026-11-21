/**
 * Sync push utilities for pushing articles to the Alcove sync service.
 * Thin wrapper around fetch — the extension only pushes, it doesn't pull.
 *
 * Every article is sealed to the account's inbox key before it leaves the browser
 * (packages/sync/ENCRYPTION.md); there is no way to push a readable record from here.
 */

import { SyncAuthError } from "@hicya/sync/client";
import { sealInboxRecord } from "@hicya/sync/inbox";

import { ALCOVE_APP, inboxKeyFor } from "./inbox";
import { SYNC_HOST } from "./manifest";

import type { InboxKey } from "@hicya/sync/inbox";
import type { InboxDeps } from "./inbox";

const REQUEST_TIMEOUT_MS = 30_000;

// ── Types ──────────────────────────────────────────────────────────────────

export interface SyncPushRecord {
  entityType: string;
  entityId: string;
  data: string;
  updatedAt: string;
  deleted: boolean;
}

export interface SyncPushPayload {
  records: SyncPushRecord[];
  reviewLogs: never[];
}

export interface SyncPushResult {
  accepted: number;
}

export interface ArticleRecord {
  id: string;
  url: string;
  title: string;
  author: string | null;
  site_name: string | null;
  excerpt: string | null;
  content: string | null;
  word_count: number;
  estimated_read_time: number;
  status: string;
  is_favorite: number;
  reading_progress: number;
  saved_at: string;
  read_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

// ── Article Construction ───────────────────────────────────────────────────

export function buildArticleRecord(params: {
  url: string;
  title: string;
  author: string | null;
  siteName: string | null;
  excerpt: string | null;
  content: string | null;
  wordCount: number;
  estimatedReadTime: number;
}): ArticleRecord {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    url: params.url,
    title: params.title,
    author: params.author,
    site_name: params.siteName,
    excerpt: params.excerpt,
    content: params.content,
    word_count: params.wordCount,
    estimated_read_time: params.estimatedReadTime,
    status: "inbox",
    is_favorite: 0,
    reading_progress: 0,
    saved_at: now,
    read_at: null,
    deleted_at: null,
    created_at: now,
    updated_at: now,
  };
}

/** One article, sealed to the account's inbox, ready for `/sync/push`. */
export function buildSealedSyncPayload(
  article: ArticleRecord,
  inboxKey: InboxKey,
): SyncPushPayload {
  return {
    records: [
      sealInboxRecord(inboxKey, ALCOVE_APP, {
        entityType: "article",
        entityId: article.id,
        data: JSON.stringify(article),
      }),
    ],
    reviewLogs: [],
  };
}

// ── Sync Service API ───────────────────────────────────────────────────────

export class SyncPushError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "SyncPushError";
  }
}

export type SyncPauseReason = "storage_quota_exceeded" | "write_budget_exceeded";

/** The account is over its storage quota (507) or daily write budget (429); nothing was stored. */
export class SyncPausedError extends SyncPushError {
  constructor(
    public readonly reason: SyncPauseReason,
    /** Seconds until a save can succeed, when the service said so. */
    public readonly retryAfterSeconds: number | null,
  ) {
    super(`Sync paused: ${reason}`, reason === "storage_quota_exceeded" ? 507 : 429);
    this.name = "SyncPausedError";
  }
}

/** Reads a limit response; returns null for any other failure. */
export async function readPause(response: Response): Promise<SyncPausedError | null> {
  if (response.status !== 507 && response.status !== 429) return null;
  let code: unknown = null;
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null && "error" in body) code = body.error;
  } catch {
    code = null;
  }
  const reason: SyncPauseReason | null =
    code === "storage_quota_exceeded" || (code === null && response.status === 507)
      ? "storage_quota_exceeded"
      : code === "write_budget_exceeded"
        ? "write_budget_exceeded"
        : null;
  if (!reason) return null;
  const header = Number(response.headers.get("Retry-After"));
  return new SyncPausedError(reason, Number.isFinite(header) && header > 0 ? header : null);
}

export function toSyncPushResult(value: unknown): SyncPushResult {
  if (typeof value === "object" && value !== null && "accepted" in value) {
    const { accepted } = value;
    if (typeof accepted === "number") return { accepted };
  }
  throw new SyncPushError("Unexpected sync response", 502);
}

export async function pushToSync(token: string, payload: SyncPushPayload): Promise<SyncPushResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${SYNC_HOST}/sync/push`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (response.status === 401) {
      throw new SyncPushError("Authentication expired", 401);
    }
    const pause = await readPause(response);
    if (pause) throw pause;
    if (!response.ok) {
      throw new SyncPushError(`Sync push failed: ${response.status}`, response.status);
    }

    return toSyncPushResult(await response.json());
  } finally {
    clearTimeout(timeout);
  }
}

export interface SealedPushDeps {
  /** The signed-in account (the token's `sub`); the inbox key is pinned per account. */
  accountId: () => Promise<string | null>;
  inbox: InboxDeps;
  push?: (token: string, payload: SyncPushPayload) => Promise<SyncPushResult>;
}

/** Seals the article to the account's inbox and pushes it. Never pushes it readable. */
export async function pushSealedArticle(
  token: string,
  article: ArticleRecord,
  deps: SealedPushDeps,
): Promise<SyncPushResult> {
  const accountId = await deps.accountId();
  if (!accountId) throw new SyncAuthError();
  const inboxKey = await inboxKeyFor(token, accountId, deps.inbox);
  return (deps.push ?? pushToSync)(token, buildSealedSyncPayload(article, inboxKey));
}
