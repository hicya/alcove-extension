/**
 * Chrome extension auth using @hicya/auth-sdk PKCE utilities.
 *
 * Tokens stored in chrome.storage.local (persists across browser restarts).
 * PKCE verifiers stored in chrome.storage.session (cleared on browser close).
 *
 * Uses chrome.identity.launchWebAuthFlow() for OAuth — no popup page needed. The redirect
 * URI comes from chrome.identity.getRedirectURL(): https://<id>.chromiumapp.org/ on Chrome
 * and Edge, https://<hash>.extensions.allizom.org/ on Firefox. Both are allowed for the
 * "alcove" client in apps/auth-service/src/lib/clients.ts.
 * The extension shares client_id "alcove" with the web app so synced data
 * is in the same partition.
 */

import { generateCodeVerifier, generateCodeChallenge } from "@hicya/auth-sdk";

import { AUTH_HOST } from "./manifest";

import type { SignInProvider } from "./messaging";
import type { AuthTokens, TokenStorage, PkceStorage } from "@hicya/auth-sdk";

const AUTH_URL = AUTH_HOST;
const CLIENT_ID = "alcove";

const STORAGE_KEY = "alcove_tokens";
const PKCE_KEY = "alcove_pkce_verifier";

// ── Token Storage (chrome.storage.local) ───────────────────────────────────

export class ChromeTokenStorage implements TokenStorage {
  async getTokens(): Promise<AuthTokens | null> {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    return toAuthTokens(result[STORAGE_KEY]);
  }

  async setTokens(tokens: AuthTokens): Promise<void> {
    await chrome.storage.local.set({ [STORAGE_KEY]: tokens });
  }

  async clearTokens(): Promise<void> {
    await chrome.storage.local.remove(STORAGE_KEY);
  }
}

// ── PKCE Storage (chrome.storage.session) ──────────────────────────────────

export class ChromePkceStorage implements PkceStorage {
  async set(verifier: string): Promise<void> {
    await chrome.storage.session.set({ [PKCE_KEY]: verifier });
  }

  async get(): Promise<string | null> {
    const result = await chrome.storage.session.get(PKCE_KEY);
    const verifier: unknown = result[PKCE_KEY];
    return typeof verifier === "string" ? verifier : null;
  }

  async clear(): Promise<void> {
    await chrome.storage.session.remove(PKCE_KEY);
  }
}

// ── Singleton instances ────────────────────────────────────────────────────

const tokenStorage = new ChromeTokenStorage();
const pkceStorage = new ChromePkceStorage();

// ── Validation ─────────────────────────────────────────────────────────────

/** Validate a token response (or a stored value) at the boundary. */
export function toAuthTokens(value: unknown): AuthTokens | null {
  if (typeof value !== "object" || value === null || !("accessToken" in value)) return null;
  const { accessToken } = value;
  if (typeof accessToken !== "string" || accessToken === "") return null;
  const refreshToken =
    "refreshToken" in value && typeof value.refreshToken === "string"
      ? value.refreshToken
      : undefined;
  const expiresIn =
    "expiresIn" in value && typeof value.expiresIn === "number" ? value.expiresIn : 0;
  return { accessToken, refreshToken, expiresIn };
}

// ── JWT Helpers ────────────────────────────────────────────────────────────

export interface JwtPayload {
  exp: number;
  email: string | null;
  /** The Hicya account id (`sub`). */
  sub: string | null;
}

export function decodeJwtPayload(token: string): JwtPayload {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid JWT");
  const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), "=");
  const parsed: unknown = JSON.parse(atob(padded));
  if (typeof parsed !== "object" || parsed === null || !("exp" in parsed)) {
    throw new Error("Invalid JWT payload");
  }
  const { exp } = parsed;
  if (typeof exp !== "number") throw new Error("Invalid JWT payload");
  const email = "email" in parsed && typeof parsed.email === "string" ? parsed.email : null;
  const sub = "sub" in parsed && typeof parsed.sub === "string" ? parsed.sub : null;
  return { exp, email, sub };
}

export function isTokenExpired(token: string): boolean {
  try {
    const { exp } = decodeJwtPayload(token);
    // Consider expired 60s before actual expiry to avoid race conditions
    return Date.now() >= (exp - 60) * 1000;
  } catch {
    return true;
  }
}

// ── Auth API ───────────────────────────────────────────────────────────────

/**
 * Get a valid access token. Returns null if not logged in or refresh fails.
 * Automatically refreshes expired tokens.
 */
export async function getAccessToken(): Promise<string | null> {
  const tokens = await tokenStorage.getTokens();
  if (!tokens?.accessToken) return null;

  if (!isTokenExpired(tokens.accessToken)) {
    return tokens.accessToken;
  }

  // Token expired — try to refresh
  if (!tokens.refreshToken) return null;

  try {
    const refreshed = await refreshTokens(tokens.refreshToken);
    return refreshed.accessToken;
  } catch {
    // Refresh failed — user needs to re-login
    await tokenStorage.clearTokens();
    return null;
  }
}

/**
 * Get the logged-in user's email, or null if not logged in.
 */
export async function getEmail(): Promise<string | null> {
  const tokens = await tokenStorage.getTokens();
  if (!tokens?.accessToken) return null;
  try {
    const { email } = decodeJwtPayload(tokens.accessToken);
    return email;
  } catch {
    return null;
  }
}

/**
 * The signed-in Hicya account id (the token's `sub`), or null when signed out. Used only as the
 * analytics user ID; never the email.
 */
export async function getAccountId(): Promise<string | null> {
  const tokens = await tokenStorage.getTokens();
  if (!tokens?.accessToken) return null;
  try {
    return decodeJwtPayload(tokens.accessToken).sub;
  } catch {
    return null;
  }
}

/**
 * Start the OAuth login flow via chrome.identity.launchWebAuthFlow.
 * Opens the auth.hicya.org sign-in page (Google or Apple), captures the redirect, and
 * exchanges the auth code for tokens.
 */
let loginInFlight: Promise<AuthTokens> | null = null;

/**
 * Signs in through auth.hicya.org. With a provider the hosted page goes straight to Apple or
 * Google; without one it shows its own chooser.
 */
export function login(provider?: SignInProvider): Promise<AuthTokens> {
  // A second click while the sign-in window is open joins the same flow.
  loginInFlight ??= runLoginFlow(provider).finally(() => {
    loginInFlight = null;
  });
  return loginInFlight;
}

async function runLoginFlow(provider?: SignInProvider): Promise<AuthTokens> {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  await pkceStorage.set(codeVerifier);

  const redirectUri = chrome.identity.getRedirectURL();

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  if (provider) params.set("provider", provider);

  const authUrl = `${AUTH_URL}/authorize?${params.toString()}`;

  const responseUrl = await chrome.identity.launchWebAuthFlow({
    url: authUrl,
    interactive: true,
  });

  if (!responseUrl) {
    await pkceStorage.clear();
    throw new Error("Auth flow was cancelled");
  }

  const url = new URL(responseUrl);
  const code = url.searchParams.get("code");
  if (!code) {
    await pkceStorage.clear();
    const error = url.searchParams.get("error") ?? "No auth code received";
    throw new Error(`Auth failed: ${error}`);
  }

  // Exchange code for tokens
  const storedVerifier = await pkceStorage.get();
  if (!storedVerifier) {
    throw new Error("PKCE verifier not found");
  }

  const tokens = await exchangeCode(code, storedVerifier, redirectUri);
  await pkceStorage.clear();
  await tokenStorage.setTokens(tokens);

  return tokens;
}

/**
 * Log out — clear stored tokens.
 */
export async function logout(): Promise<void> {
  await tokenStorage.clearTokens();
}

/**
 * Check if the user is currently logged in (has stored tokens).
 */
export async function isLoggedIn(): Promise<boolean> {
  const token = await getAccessToken();
  return token !== null;
}

// ── Internal HTTP Helpers ──────────────────────────────────────────────────

async function exchangeCode(
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<AuthTokens> {
  const response = await fetch(`${AUTH_URL}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      code_verifier: codeVerifier,
      client_id: CLIENT_ID,
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Token exchange failed: ${response.status} ${text}`);
  }

  const tokens = toAuthTokens(await response.json());
  if (!tokens) throw new Error("Token exchange returned an unexpected response");
  return tokens;
}

async function refreshTokens(refreshToken: string): Promise<AuthTokens> {
  const response = await fetch(`${AUTH_URL}/token/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    throw new Error(`Token refresh failed: ${response.status}`);
  }

  const refreshed = toAuthTokens(await response.json());
  if (!refreshed) throw new Error("Token refresh returned an unexpected response");
  // Keep the current refresh token if the response did not rotate it.
  const tokens: AuthTokens = { ...refreshed, refreshToken: refreshed.refreshToken ?? refreshToken };
  await tokenStorage.setTokens(tokens);
  return tokens;
}
