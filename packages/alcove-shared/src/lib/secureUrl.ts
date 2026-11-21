/**
 * Secure page fetching for every Alcove surface.
 *
 * Alcove never downloads a non-loopback page over plain http. An `http://` article URL is
 * tried over `https://` first; when that attempt fails the surface shows
 * {@link INSECURE_ONLY_MESSAGE} instead of an offline or generic error. Loopback hosts
 * (QA fixtures on localhost and 127.0.0.1) keep plain http.
 */

/** The exact copy every surface shows when only the insecure page exists. */
export const INSECURE_ONLY_MESSAGE = "This page isn't available over a secure connection";

export type SecureFetchFailure = "insecure_only";

/** True for localhost, the 127.0.0.0/8 range and ::1. Accepts bracketed IPv6. */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  // RFC 6761 reserves .localhost for loopback, so its subdomains resolve to this device too.
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1") return true;
  const parts = host.split(".");
  return (
    parts.length === 4 &&
    parts[0] === "127" &&
    parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
  );
}

export interface SecureFetchTarget {
  /** The URL to request. */
  url: string;
  /** True when an http URL was rewritten to https, so a failure means insecure_only. */
  upgraded: boolean;
}

/** Decides what to request for `url`: https for non-loopback http, the input otherwise. */
export function secureFetchTarget(url: string): SecureFetchTarget {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { url, upgraded: false };
  }
  if (parsed.protocol !== "http:" || isLoopbackHost(parsed.hostname)) {
    return { url, upgraded: false };
  }
  parsed.protocol = "https:";
  return { url: parsed.toString(), upgraded: true };
}

/** The https form of a non-loopback http URL; any other input comes back unchanged. */
export function secureFetchUrl(url: string): string {
  return secureFetchTarget(url).url;
}

/**
 * Sync proxy (`POST /proxy/fetch`) statuses meaning the target site itself couldn't be reached:
 * 502 (network, TLS or upstream error) and 504 (timeout). For an upgraded URL these are
 * insecure_only; auth, rate-limit and validation statuses are not.
 */
export function isProxyUpstreamFailure(status: number): boolean {
  return status === 502 || status === 504;
}

/** Thrown when the https attempt for an upgraded http URL failed. */
export class InsecureOnlyError extends Error {
  readonly code: SecureFetchFailure = "insecure_only";

  constructor(readonly originalUrl: string) {
    super(INSECURE_ONLY_MESSAGE);
    this.name = "InsecureOnlyError";
  }
}

export function isInsecureOnlyError(err: unknown): err is InsecureOnlyError {
  return err instanceof InsecureOnlyError;
}
