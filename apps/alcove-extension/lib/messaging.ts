/** Message shapes shared by the background script, the injected capture script and the options page. */

// ── Capture results (injected script → background) ─────────────────────────

export interface CaptureArticleSuccess {
  title: string;
  author: string | null;
  siteName: string | null;
  excerpt: string | null;
  content: string;
  textContent: string;
  wordCount: number;
  estimatedReadTime: number;
  url: string;
}

export interface CaptureArticleError {
  error: string;
}

export type CaptureArticleResponse = CaptureArticleSuccess | CaptureArticleError;

export function isCaptureError(response: CaptureArticleResponse): response is CaptureArticleError {
  return "error" in response;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

/** Validate a value returned by executeScript. Anything unexpected becomes an error result. */
export function toCaptureResponse(value: unknown): CaptureArticleResponse {
  if (!isRecord(value)) return { error: "The page could not be read" };
  if (typeof value.error === "string") return { error: value.error };

  const {
    title,
    author,
    siteName,
    excerpt,
    content,
    textContent,
    wordCount,
    estimatedReadTime,
    url,
  } = value;
  if (
    typeof title !== "string" ||
    !isStringOrNull(author) ||
    !isStringOrNull(siteName) ||
    !isStringOrNull(excerpt) ||
    typeof content !== "string" ||
    typeof textContent !== "string" ||
    typeof wordCount !== "number" ||
    typeof estimatedReadTime !== "number" ||
    typeof url !== "string"
  ) {
    return { error: "The page could not be read" };
  }
  return {
    title,
    author,
    siteName,
    excerpt,
    content,
    textContent,
    wordCount,
    estimatedReadTime,
    url,
  };
}

// ── Options page ↔ background ──────────────────────────────────────────────

export interface AuthStateResponse {
  loggedIn: boolean;
  email?: string;
}

export interface ActionResponse {
  ok?: boolean;
  error?: string;
}

export type SignInProvider = "apple" | "google";

export type BackgroundMessage =
  | { type: "GET_AUTH_STATE" }
  | { type: "LOGIN"; provider?: SignInProvider }
  | { type: "LOGOUT" };

export function isSignInProvider(value: unknown): value is SignInProvider {
  return value === "apple" || value === "google";
}

export function isBackgroundMessage(value: unknown): value is BackgroundMessage {
  if (!isRecord(value)) return false;
  if (value.type === "LOGIN")
    return value.provider === undefined || isSignInProvider(value.provider);
  return value.type === "GET_AUTH_STATE" || value.type === "LOGOUT";
}

export function toAuthState(value: unknown): AuthStateResponse {
  if (!isRecord(value) || value.loggedIn !== true) return { loggedIn: false };
  return { loggedIn: true, email: typeof value.email === "string" ? value.email : undefined };
}

export function toActionResponse(value: unknown): ActionResponse {
  if (!isRecord(value)) return { error: "No response from Alcove" };
  return {
    ok: value.ok === true,
    error: typeof value.error === "string" ? value.error : undefined,
  };
}
