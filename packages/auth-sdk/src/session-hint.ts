/**
 * A readable "this browser may have a session" hint, so a web app can skip `/token/refresh` for
 * visitors who were never signed in. The refresh cookie itself is httpOnly and invisible to the
 * page, so without a hint every anonymous page load would spend a request on the auth Worker.
 *
 * The hint is only an optimization: it never grants anything, and a wrong hint costs at most one
 * failed refresh (which clears it) or one skipped refresh (signed out, as without a session).
 *
 * Where it comes from:
 * - The auth service sets `hicya_session=1` next to the refresh cookie (Path=/, and in production
 *   Domain=.hicya.org, so apps on hicya.org subdomains can read it) and clears it with it.
 * - The SDK sets the same name on the app's own host after every successful grant, which covers
 *   apps on other domains and local development, and clears it on sign-out, account deletion and
 *   a refused refresh.
 *
 * Rollout: browsers signed in before the hint existed have a refresh cookie but no hint. With no
 * hint, the SDK still tries one refresh per browser and app origin (recorded in localStorage under
 * `hicya_session_probe`); a success sets the hint, and later loads without a hint skip the call.
 */

export const SESSION_HINT_COOKIE = "hicya_session";
const PROBE_KEY = "hicya_session_probe";
const MAX_AGE = 30 * 24 * 60 * 60; // The refresh cookie's lifetime.

export interface SessionHint {
  /** True when a refresh may succeed and should be attempted. */
  shouldRefresh(): boolean;
  /** After a successful grant or refresh. */
  set(): void;
  /** After sign-out, account deletion or a refused refresh. */
  clear(): void;
}

interface CookieDocument {
  cookie: string;
}

interface PageLocation {
  protocol: string;
  hostname: string;
}

interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * The page's document, location and localStorage, read from globalThis so this module also
 * typechecks (and does nothing) where the DOM library is absent: servers, workers, React Native.
 */
interface Page {
  document: CookieDocument;
  location: PageLocation;
  storage: KeyValueStore | null;
}

function isCookieDocument(value: unknown): value is CookieDocument {
  return (
    typeof value === "object" &&
    value !== null &&
    "cookie" in value &&
    typeof value.cookie === "string"
  );
}

function isPageLocation(value: unknown): value is PageLocation {
  return (
    typeof value === "object" &&
    value !== null &&
    "protocol" in value &&
    typeof value.protocol === "string" &&
    "hostname" in value &&
    typeof value.hostname === "string"
  );
}

function isKeyValueStore(value: unknown): value is KeyValueStore {
  return (
    typeof value === "object" &&
    value !== null &&
    "getItem" in value &&
    typeof value.getItem === "function" &&
    "setItem" in value &&
    typeof value.setItem === "function"
  );
}

function currentPage(): Page | null {
  const document: unknown = Reflect.get(globalThis, "document");
  const location: unknown = Reflect.get(globalThis, "location");
  if (!isCookieDocument(document) || !isPageLocation(location)) return null;
  let storage: KeyValueStore | null = null;
  try {
    const candidate: unknown = Reflect.get(globalThis, "localStorage");
    storage = isKeyValueStore(candidate) ? candidate : null;
  } catch {
    // Storage blocked by the browser: the probe then runs on every load.
  }
  return { document, location, storage };
}

function readCookie(page: Page, name: string): string | null {
  for (const part of page.document.cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

/** The parent domain the auth service scopes its cookies to, when this page is under it. */
function sharedDomain(hostname: string): string | null {
  return hostname === "hicya.org" || hostname.endsWith(".hicya.org") ? ".hicya.org" : null;
}

function readProbe(page: Page): boolean {
  try {
    return page.storage?.getItem(PROBE_KEY) != null;
  } catch {
    return false;
  }
}

function writeProbe(page: Page): void {
  try {
    page.storage?.setItem(PROBE_KEY, "1");
  } catch {
    // Without storage the probe runs on every load, as before the hint existed.
  }
}

function browserHintFor(page: Page): SessionHint {
  const secure = page.location.protocol === "https:" ? "; Secure" : "";
  return {
    shouldRefresh() {
      if (readCookie(page, SESSION_HINT_COOKIE) !== null) return true;
      if (readProbe(page)) return false;
      writeProbe(page);
      return true;
    },
    set() {
      page.document.cookie = `${SESSION_HINT_COOKIE}=1; Path=/; Max-Age=${String(MAX_AGE)}; SameSite=Lax${secure}`;
      writeProbe(page);
    },
    clear() {
      page.document.cookie = `${SESSION_HINT_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
      const domain = sharedDomain(page.location.hostname);
      if (domain) {
        page.document.cookie = `${SESSION_HINT_COOKIE}=; Path=/; Domain=${domain}; Max-Age=0; SameSite=Lax${secure}`;
      }
    },
  };
}

/** The browser hint: the `hicya_session` cookie plus the one-time rollout probe. */
export function browserSessionHint(): SessionHint {
  const page = currentPage();
  if (!page) throw new Error("browserSessionHint needs a browser page");
  return browserHintFor(page);
}

/** The default: the browser hint in a page, none elsewhere (React Native, servers, workers). */
export function defaultSessionHint(): SessionHint | null {
  const page = currentPage();
  return page ? browserHintFor(page) : null;
}
