/**
 * Fetch a link's HTML through the sync service's authenticated proxy
 * (`POST sync.hicya.org/proxy/fetch`), the same endpoint the web app uses. The extension
 * therefore needs no access to the linked site itself.
 */

import { SYNC_HOST } from "./manifest";

const REQUEST_TIMEOUT_MS = 20_000;

export interface ProxyPage {
  html: string;
  contentType: string;
  finalUrl: string;
}

export class ProxyFetchError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ProxyFetchError";
  }
}

export function toProxyPage(value: unknown): ProxyPage | null {
  if (typeof value !== "object" || value === null) return null;
  if (!("html" in value) || !("contentType" in value) || !("finalUrl" in value)) return null;
  const { html, contentType, finalUrl } = value;
  if (typeof html !== "string" || typeof contentType !== "string" || typeof finalUrl !== "string") {
    return null;
  }
  return { html, contentType, finalUrl };
}

export function isHtmlContentType(contentType: string): boolean {
  const type = contentType.split(";")[0].trim().toLowerCase();
  return type === "text/html" || type === "application/xhtml+xml";
}

export async function fetchViaProxy(token: string, url: string): Promise<ProxyPage> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${SYNC_HOST}/proxy/fetch`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new ProxyFetchError(`Proxy fetch failed: ${response.status}`, response.status);
    }
    const page = toProxyPage(await response.json());
    if (!page) throw new ProxyFetchError("Unexpected proxy response", 502);
    return page;
  } finally {
    clearTimeout(timeout);
  }
}
